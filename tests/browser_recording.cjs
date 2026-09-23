// Chromium's fake microphone feeds the real getUserMedia / MediaRecorder pipeline.
// Run with NODE_PATH pointing to Playwright; no model or physical microphone is used.
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

(async () => {
  const browser = await chromium.launch({headless: true,
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.micStreams = [];
      window.micMode = 'normal';
      const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        if (window.micMode === 'denied') throw new DOMException('Denied', 'NotAllowedError');
        if (window.micMode === 'missing') throw new DOMException('Missing', 'NotFoundError');
        if (window.micMode === 'pending') await new Promise(resolve => { window.grantMicrophone = resolve; });
        const stream = await original(constraints);
        window.micStreams.push(stream);
        return stream;
      };
    });
    await page.route('https://qwen.test/**', route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/maker') return route.fulfill({contentType: 'text/html',
        body: fs.readFileSync(path.join(__dirname, '../src/qwen3_tts_web/web/maker.html'))});
      if (pathname === '/api/pt/list') return route.fulfill({json: {roles: {}}});
      if (pathname === '/api/pt/upload') {
        const data = route.request().postDataBuffer();
        const start = data.indexOf(Buffer.from('RIFF'));
        assert.ok(start >= 0, 'recording must be converted to cropped WAV');
        const rate = data.readUInt32LE(start + 24);
        const samples = data.readUInt32LE(start + 40) / 2;
        assert.ok(Math.abs(samples / rate - 0.6) < 0.02, 'only the selected range is uploaded');
        requests.push({type: 'upload', duration: samples / rate});
        return route.fulfill({json: {path: '/tmp/recording-clip.wav'}});
      }
      if (pathname === '/api/pt/create') {
        const data = route.request().postDataJSON();
        requests.push({type: 'create', ...data});
        return route.fulfill({json: {...data, status: 'ok', rel: 'Test/Test_平静.pt',
          path: '/tmp/Test_平静.pt', items: 1, x_vector_only: true}});
      }
      return route.fulfill({status: 404});
    });
    await page.goto('https://qwen.test/maker');
    assert.equal(await page.locator('#recordStart').isEnabled(), true);
    assert.equal(await page.locator('#recordStop').isDisabled(), true);
    assert.equal(await page.evaluate(() => micStreams.length), 0, 'no microphone access before start');

    await page.evaluate(() => { micMode = 'denied'; });
    await page.click('#recordStart');
    await page.waitForFunction(() => document.querySelector('#recordStatus').textContent.includes('权限被拒绝'));
    assert.equal(await page.locator('#recordStart').isEnabled(), true);
    await page.evaluate(() => { micMode = 'missing'; });
    await page.click('#recordStart');
    await page.waitForFunction(() => document.querySelector('#recordStatus').textContent.includes('没有找到麦克风'));

    // Cancelling a permission prompt must also release a later-granted stream.
    await page.evaluate(() => { micMode = 'pending'; });
    await page.click('#recordStart');
    await page.click('#recordCancel');
    await page.evaluate(() => grantMicrophone());
    await page.waitForFunction(() => micStreams.length === 1 && micStreams[0].getTracks().every(track => track.readyState === 'ended'));
    assert.equal(await page.locator('#waveBox').evaluate(el => el.classList.contains('show')), false);

    await page.evaluate(() => { micMode = 'normal'; });
    await page.click('#recordStart');
    await page.waitForFunction(() => capture?.recorder?.state === 'recording');
    assert.equal(await page.locator('#file').isDisabled(), true);
    assert.equal(await page.locator('#submit').isDisabled(), true);
    await page.waitForFunction(() => document.querySelector('#recordTime').textContent !== '00:00');
    await page.click('#recordStop');
    await page.waitForFunction(() => !capture && audioBuffer?.duration > .8);
    assert.equal(await page.locator('#confirmBtn').isEnabled(), true);
    assert.equal(await page.locator('#fileName').textContent().then(name => name.startsWith('recording-')), true);
    assert.equal(await page.evaluate(() => micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);
    assert.equal(requests.length, 0, 'recording and trimming must remain local until submit');
    assert.equal(await page.locator('#wave').evaluate(canvas => {
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 1] > pixels[i] + 30) return true;
      return false;
    }), true, 'waveform must render');

    await page.fill('#startIn', '0.2');
    await page.locator('#startIn').press('Tab');
    await page.fill('#endIn', '0.8');
    await page.locator('#endIn').press('Tab');
    await page.click('#previewBtn');
    await page.waitForFunction(() => isPreviewing);
    await page.click('#previewBtn');
    await page.click('#confirmBtn');
    await page.fill('#role', 'Test');
    await page.click('#submit');
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('生成成功'));
    assert.equal(requests[1].emotion, '平静');
    assert.equal(requests[1].ref_audio, '/tmp/recording-clip.wav');
    const name = await page.locator('#fileName').textContent();

    // Cancelling a replacement preserves the previous crop and audio.
    await page.click('#recordStart');
    await page.waitForFunction(() => capture?.recorder?.state === 'recording');
    await page.click('#recordCancel');
    assert.equal(await page.locator('#fileName').textContent(), name);
    assert.equal(await page.evaluate(() => cropLocked), true);
    assert.equal(await page.locator('#submit').isEnabled(), true);
    assert.equal(await page.evaluate(() => micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);

    await page.click('#recordStart');
    await page.waitForFunction(() => capture?.recorder?.state === 'recording');
    await page.evaluate(() => capture.recorder.onerror({error: new Error('device interrupted')}));
    await page.waitForFunction(() => !capture);
    assert.ok((await page.locator('#recordStatus').textContent()).includes('录音失败'));
    assert.equal(await page.locator('#fileName').textContent(), name);
    assert.equal(await page.evaluate(() => micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);

    // Exercise the automatic limit without waiting two real minutes.
    await page.click('#recordStart');
    await page.waitForFunction(() => capture?.recorder?.state === 'recording');
    await page.waitForTimeout(600);
    await page.evaluate(() => { capture.started -= 121000; });
    await page.waitForFunction(() => !capture && !loadingAudio);
    assert.equal(await page.evaluate(() => cropLocked), false);
    assert.notEqual(await page.locator('#fileName').textContent(), name);
    await page.click('#recordStart');
    await page.waitForFunction(() => capture?.recorder?.state === 'recording');
    await page.evaluate(() => dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => micStreams.every(stream => stream.getTracks().every(track => track.readyState === 'ended'))), true);

    // Existing file selection is still available.
    const wavBytes = await page.evaluate(async () => Array.from(new Uint8Array(await exportSelectedWav().arrayBuffer())));
    await page.locator('#file').setInputFiles({name: 'uploaded.wav', mimeType: 'audio/wav', buffer: Buffer.from(wavBytes)});
    await page.waitForFunction(() => audioName === 'uploaded.wav' && !loadingAudio);
    fs.mkdirSync('.logs', {recursive: true});
    await page.screenshot({path: '.logs/recording-desktop.png', fullPage: true});
    assert.deepEqual(errors, []);

    const unsupported = await browser.newPage();
    await unsupported.addInitScript(() => { window.MediaRecorder = undefined; });
    await unsupported.route('https://qwen.test/**', route => route.fulfill({contentType: 'text/html',
      body: fs.readFileSync(path.join(__dirname, '../src/qwen3_tts_web/web/maker.html'))}));
    await unsupported.goto('https://qwen.test/maker');
    assert.equal(await unsupported.locator('#recordStart').isDisabled(), true);
    assert.equal(await unsupported.locator('#file').isEnabled(), true);
    const insecure = await browser.newPage();
    await insecure.route('http://qwen.test/**', route => route.fulfill({contentType: 'text/html',
      body: fs.readFileSync(path.join(__dirname, '../src/qwen3_tts_web/web/maker.html'))}));
    await insecure.goto('http://qwen.test/maker');
    assert.equal(await insecure.locator('#recordStart').isDisabled(), true);
    assert.ok((await insecure.locator('#recordStatus').textContent()).includes('HTTPS'));
    assert.equal(await insecure.locator('#file').isEnabled(), true);
    console.log('Recording passed: permissions, cancel, real encoding, waveform, crop, WAV upload, retry, limit, cleanup, and file fallback.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
