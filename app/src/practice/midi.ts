/**
 * Notes from a digital piano over USB or Bluetooth MIDI. Exact where the
 * microphone guesses: every key press arrives as a number. All inputs are
 * listened to at once, and keyboards plugged in later join by themselves.
 */

export class MidiKeyboard {
  private access: MIDIAccess | null = null;
  private onNote: ((midi: number, velocity: number) => void) | null = null;
  private onChange: (() => void) | null = null;

  static get supported(): boolean {
    return typeof navigator.requestMIDIAccess === 'function';
  }

  /** Names of the connected inputs. */
  get inputs(): string[] {
    if (!this.access) return [];
    return [...this.access.inputs.values()].map((i) => i.name ?? 'MIDI');
  }

  async start(
    onNote: (midi: number, velocity: number) => void,
    onChange: () => void = () => undefined,
  ): Promise<void> {
    this.onNote = onNote;
    this.onChange = onChange;
    this.access ??= await navigator.requestMIDIAccess({ sysex: false });
    this.attach();
    this.access.onstatechange = () => {
      this.attach();
      this.onChange?.();
    };
  }

  stop(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) input.onmidimessage = null;
    this.access.onstatechange = null;
    this.onNote = null;
  }

  private attach(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      input.onmidimessage = (e: MIDIMessageEvent) => {
        const data = e.data;
        if (!data || data.length < 3) return;
        const status = data[0]! & 0xf0;
        // A note-on with velocity zero is a note-off in disguise.
        if (status === 0x90 && data[2]! > 0) this.onNote?.(data[1]!, data[2]!);
      };
    }
  }
}
