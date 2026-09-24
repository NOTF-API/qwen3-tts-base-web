// Collect mono PCM independently of the UI thread; never monitor the microphone.
class ReferenceRecorder extends AudioWorkletProcessor {
    constructor(options) {
        super();
        this.buffer = new Float32Array(4096);
        this.offset = 0;
        this.frames = 0;
        this.limit = Math.floor(sampleRate * options.processorOptions.maxSeconds);
        this.recording = true;
        this.port.onmessage = ({data}) => {
            if (data === 'stop') this.finish('stopped');
        };
    }

    flush() {
        if (!this.offset) return;
        const samples = this.buffer.slice(0, this.offset);
        this.port.postMessage({type: 'samples', samples}, [samples.buffer]);
        this.offset = 0;
    }

    finish(type) {
        if (!this.recording) return;
        this.recording = false;
        this.flush();
        this.port.postMessage({type});
    }

    process(inputs) {
        if (!this.recording) return false;
        const channels = inputs[0];
        if (!channels?.length) return true;
        // Keep the strongest input channel; averaging can cancel out a stereo mic.
        let mono = channels[0], strongest = -1;
        for (const channel of channels) {
            const energy = channel.reduce((sum, value) => sum + value * value, 0);
            if (energy > strongest) { mono = channel; strongest = energy; }
        }
        for (let i = 0; i < mono.length; i++) {
            const value = mono[i];
            this.buffer[this.offset++] = Number.isFinite(value) ? value : 0;
            this.frames++;
            if (this.offset === this.buffer.length) this.flush();
            if (this.frames >= this.limit) {
                this.finish('limit');
                return false;
            }
        }
        return true;
    }
}

registerProcessor('reference-recorder', ReferenceRecorder);
