/**
 * Raw samples from a microphone, untouched.
 *
 * Browsers assume a microphone carries speech and clean it up for a call:
 * they cancel echo, suppress "noise" and even out the loudness. To a piano
 * that is ruin — sustained tones are treated as noise, and the automatic gain
 * flattens exactly the rises the listener looks for. All three are switched
 * off, and the samples are taken straight off the audio thread by a tiny
 * worklet, so a busy window never drops any.
 */

const WORKLET = `
class NoteTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(1024);
    this.at = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const left = input && input[0];
    if (left) {
      const right = input[1];
      for (let i = 0; i < left.length; i++) {
        this.buffer[this.at++] = right ? (left[i] + right[i]) * 0.5 : left[i];
        if (this.at === this.buffer.length) {
          this.port.postMessage(this.buffer, [this.buffer.buffer]);
          this.buffer = new Float32Array(1024);
          this.at = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('note-tap', NoteTap);
`;

export interface AudioDevice {
  id: string;
  label: string;
}

export class Microphone {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;

  /** Sample rate of the running capture; 0 when stopped. */
  get sampleRate(): number {
    return this.context?.sampleRate ?? 0;
  }

  /** Name of the device actually in use. */
  get label(): string {
    return this.stream?.getAudioTracks()[0]?.label ?? '';
  }

  static async devices(): Promise<AudioDevice[]> {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all
      .filter((d) => d.kind === 'audioinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `Mikrofon ${i + 1}` }));
  }

  async start(deviceId: string | null, onSamples: (samples: Float32Array) => void): Promise<void> {
    await this.stop();
    const audio: MediaTrackConstraints = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 1 },
    };
    if (deviceId) audio.deviceId = { exact: deviceId };
    this.stream = await navigator.mediaDevices.getUserMedia({ audio, video: false });

    this.context = new AudioContext({ latencyHint: 'interactive' });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    try {
      await this.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const source = this.context.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.context, 'note-tap', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 2,
      channelCountMode: 'explicit',
    });
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => onSamples(e.data);
    // A node nobody listens to may not be run at all; a silent path to the
    // speakers keeps the audio thread pulling it.
    const mute = this.context.createGain();
    mute.gain.value = 0;
    source.connect(this.node).connect(mute).connect(this.context.destination);
    if (this.context.state === 'suspended') await this.context.resume();
  }

  async stop(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    this.node = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    const context = this.context;
    this.context = null;
    if (context) await context.close().catch(() => undefined);
  }
}
