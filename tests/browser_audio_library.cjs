// Run with NODE_PATH pointing to a Playwright installation. HTTP/model calls are mocked.
const { chromium } = require('playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const path = require('node:path');

function wav() {
  const n = 24000;
  const result = Buffer.alloc(44 + n * 2);
  result.write('RIFF'); result.writeUInt32LE(36 + n * 2, 4); result.write('WAVEfmt ', 8);
  result.writeUInt32LE(16, 16); result.writeUInt16LE(1, 20); result.writeUInt16LE(1, 22);
  result.writeUInt32LE(24000, 24); result.writeUInt32LE(48000, 28);
  result.writeUInt16LE(2, 32); result.writeUInt16LE(16, 34); result.write('data', 36);
  result.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) result.writeInt16LE(Math.round(Math.sin(i * .1) * 4000), 44 + i * 2);
  return result;
}

(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? {executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE} : {})});
  const audio = wav();
  try {
    for (const width of [1440, 1920]) {
      const page = await browser.newPage({viewport: {width, height: 900}});
      const errors = [], requests = [], downloads = [];
      let records = [], counter = 0, failAudio = false, offline = false, installed = true;
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      page.on('download', download => downloads.push(download.suggestedFilename()));
      await page.route('http://qwen.test/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        const payload = request.postData() ? request.postDataJSON() : {};
        const json = data => route.fulfill({json: data});
        if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: fs.readFileSync(path.join(__dirname, '../src/qwen3_tts_web/web/index.html'))});
        if (url.pathname === '/api/pt/list') return json({roles: {Test: ['平静', '愤怒'], Solo: ['平静']}, count: 3});
        if (url.pathname === '/api/capabilities') return json({voice_design: {installed, offline}});
        if (url.pathname === '/api/clips') {
          if (method === 'POST') {
            const record = {...payload, id: String(++counter), created_at: new Date().toISOString(), available: false};
            records.push(record); return json(record);
          }
          return json({clips: records});
        }
        if (url.pathname === '/api/clips/export') {
          requests.push({endpoint: 'export', ...payload});
          return route.fulfill({contentType: 'application/zip', body: Buffer.from('mock zip')});
        }
        if (url.pathname.startsWith('/api/clips/')) {
          const id = url.pathname.split('/')[3];
          const record = records.find(item => item.id === id);
          if (!record) return route.fulfill({status: 404, json: {detail: 'missing'}});
          if (method === 'PATCH') Object.assign(record, payload);
          if (method === 'DELETE') records = records.filter(item => item.id !== id);
          if (url.pathname.endsWith('/download')) return route.fulfill({contentType: 'audio/wav', headers: {'Content-Disposition': 'attachment; filename="audio.wav"'}, body: audio});
          return json(record);
        }
        if (['/api/tts', '/api/voice-design'].includes(url.pathname)) {
          requests.push({endpoint: url.pathname, ...payload});
          const record = records.find(item => item.id === payload.clip_id);
          Object.assign(record, {available: true, filename: record.id + '.wav', url: '/static/audio/' + record.id + '.wav', duration: 1,
            generated: {...payload, instruct: payload.instruct || ''}});
          return json({status: 'ok', url: record.url, clip: record});
        }
        if (url.pathname.startsWith('/static/audio/')) {
          if (failAudio) return route.fulfill({status: 503, json: {detail: 'audio unavailable'}});
          return route.fulfill({contentType: 'audio/wav', body: audio});
        }
        return route.fulfill({status: 404});
      });
      await page.goto('http://qwen.test/');
      await page.waitForFunction(() => !document.querySelector('#genBtn').disabled);
      assert.deepEqual(await page.locator('#genEmotionOptions option').allTextContents(), ['平静', '愤怒']);
      await page.fill('#genEmotion', '期待');
      await page.selectOption('#genRole', 'Solo');
      assert.equal(await page.locator('#genEmotion').inputValue(), '期待', 'role changes must not replace custom emotion');
      assert.deepEqual(await page.locator('#genEmotionOptions option').allTextContents(), ['平静']);
      await page.selectOption('#genRole', 'Test');
      await page.fill('#genEmotion', '愤怒');
      await page.fill('#genText', '这是一段克隆语音。');
      await page.click('#genBtn');
      await page.waitForFunction(() => document.querySelector('#statReady').textContent === '1');
      assert.equal(requests.find(item => item.endpoint === '/api/tts').emotion, '愤怒');
      assert.equal(await page.locator('#playBtn').isEnabled(), true);
      assert.equal(await page.evaluate(() => clips[0].buffer), null, 'generation must not depend on decoding');
      await page.click('#playBtn');
      await page.waitForFunction(() => isPlaying);
      await page.click('#stopBtn');
      await page.locator('.emo-select').fill('期待');
      await page.locator('.emo-select').press('Tab');
      await page.waitForFunction(() => clips[0].emotion === '期待' && !clips[0].saveError);
      await page.evaluate(() => clips[0].saving);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('#statReady').textContent === '1');
      assert.equal(await page.locator('.emo-select').inputValue(), '期待');
      await page.locator('.clip-title').click();
      assert.equal(await page.locator('#editEmotion').inputValue(), '期待');
      await page.fill('#editEmotion', '  ');
      await page.click('#saveEdit');
      await page.waitForFunction(() => !document.querySelector('#editDialog').open);
      assert.equal(await page.locator('.emo-select').inputValue(), '平静', 'blank emotion defaults to calm');
      await page.locator('.clip-title').click();
      await page.fill('#editEmotion', '愤怒');
      await page.click('#saveEdit');
      await page.waitForFunction(() => !document.querySelector('#editDialog').open);
      const cloneRegenerated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/tts');
      await page.locator('.regen').click();
      await cloneRegenerated;
      await page.waitForFunction(() => !queueWorkerRunning);
      assert.equal(requests.filter(item => item.endpoint === '/api/tts').at(-1).emotion, '愤怒');
      assert.equal(await page.locator('.icon-btn.play').isEnabled(), true);
      failAudio = true;
      await page.locator('.icon-btn.play').click();
      await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('播放失败'));
      assert.equal(await page.locator('#playBtn').isEnabled(), true, 'failed download must remain retryable');
      failAudio = false;
      await page.locator('.icon-btn.play').click();
      await page.waitForFunction(() => isPlaying);
      await page.click('#stopBtn');
      await page.click('#designTab');
      await page.fill('#genInstruct', '温暖的年轻女声，语速舒缓。');
      await page.fill('#genText', '这是用自然语言设计的声音。');
      await page.selectOption('#genLanguage', 'Japanese');
      installed = false; offline = true;
      await page.click('#genBtn');
      await page.waitForFunction(() => document.querySelector('#genStatus').textContent.includes('离线'));
      assert.equal(records.length, 1);
      offline = false;
      await page.click('#genBtn');
      await page.waitForFunction(() => document.querySelector('#statReady').textContent === '2');
      const design = requests.find(item => item.endpoint === '/api/voice-design');
      assert.equal(design.instruct, '温暖的年轻女声，语速舒缓。');
      assert.equal(design.allow_download, true);
      assert.equal(design.language, 'Japanese');
      await page.locator('.clip-title').last().click();
      await page.fill('#editTitle', '设计音色演示');
      await page.fill('#editInstruct', '沉稳、低沉的男声');
      await page.click('#saveEdit');
      await page.waitForFunction(() => !document.querySelector('#editDialog').open);
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.clip-row').length === 2);
      assert.equal(await page.locator('.clip-title').last().textContent(), '设计音色演示');
      assert.equal(await page.locator('.clip-row.dirty').count(), 1);
      await page.locator('.prompt-cell').fill('有活力的明亮女声');
      await page.locator('.prompt-cell').press('Tab');
      await page.evaluate(() => clips[1].saving);
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.clip-row').length === 2);
      assert.equal(await page.locator('.prompt-cell').inputValue(), '有活力的明亮女声');
      installed = true;
      const designRegenerated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/voice-design');
      await page.locator('.regen').last().click();
      await designRegenerated;
      await page.waitForFunction(() => !queueWorkerRunning);
      assert.equal(requests.filter(item => item.endpoint === '/api/voice-design').at(-1).instruct, '有活力的明亮女声');
      await page.click('#selectAll');
      await page.click('#exportSelected');
      await page.waitForFunction(() => document.querySelector('#statusText').textContent.includes('已导出'));
      assert.deepEqual(requests.find(item => item.endpoint === 'export').ids, ['1', '2']);
      await page.locator('[title="导出原始 WAV"]').first().click();
      await page.waitForTimeout(100);
      assert.ok(downloads.includes('audio.wav'));
      await page.fill('#librarySearch', '设计');
      assert.equal(await page.locator('.clip-row').count(), 1);
      await page.fill('#librarySearch', '');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'viewport overflow');
      await page.click('#designTab');
      fs.mkdirSync('.logs', {recursive: true});
      await page.screenshot({path: '.logs/library-' + width + '.png', fullPage: true});
      await page.locator('.icon-btn.del').last().click();
      await page.waitForFunction(() => document.querySelectorAll('.clip-row').length === 1);
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.clip-row').length === 1);
      assert.equal(records.length, 1);
      records.push({id: 'legacy', title: '历史音频', synthesis_mode: 'legacy', emotion: '平静',
        available: true, url: '/static/audio/legacy.wav', duration: 1, created_at: new Date().toISOString()});
      await page.reload();
      await page.waitForFunction(() => document.querySelectorAll('.clip-row').length === 2);
      assert.equal(await page.locator('.emo-select').last().isEnabled(), true);
      await page.locator('.emo-select').last().fill('期待');
      await page.locator('.emo-select').last().press('Tab');
      await page.evaluate(() => clips[1].saving);
      await page.locator('.clip-title').last().click();
      assert.equal(await page.locator('#editEmotion').inputValue(), '期待');
      await page.fill('#editEmotion', '激动');
      await page.click('#saveEdit');
      await page.waitForFunction(() => !document.querySelector('#editDialog').open);
      assert.equal(records.find(record => record.id === 'legacy').emotion, '激动');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('Desktop passed: generation, playback, reload, retry, VoiceDesign, edit, export, delete, and layout.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
