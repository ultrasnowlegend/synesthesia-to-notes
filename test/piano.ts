import { partialFrequency } from '../src/core/listen.js';

/**
 * A synthetic piano good enough to test the listener on: stretched partials,
 * two slightly detuned strings per note so the partials beat, partials that
 * die away the faster the higher they are, and the knock of the hammer and the
 * body — the low thump every real strike carries.
 */
export function pianoTone(
  midi: number,
  sampleRate: number,
  seconds: number,
  velocity = 0.5,
): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  let seed = midi * 7919 + 17;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let n = 1; n <= 18; n++) {
    const f = partialFrequency(midi, n);
    if (f > sampleRate / 2.2) break;
    // Bass fundamentals are weak; the spectrum peaks a few partials up.
    const shape = midi < 48 ? Math.min(1, n / 3) : 1;
    const amplitude = (velocity * shape) / Math.pow(n, 0.9);
    const tau = 3.5 / (1 + 0.35 * n) / (1 + Math.max(0, midi - 60) / 30);
    const detune = Math.pow(2, (0.8 + random() * 0.6) / 1200);
    const phase = random() * Math.PI * 2;
    for (let i = 0; i < out.length; i++) {
      const t = i / sampleRate;
      const attack = Math.min(1, t / 0.003);
      const envelope = attack * Math.exp(-t / tau);
      out[i]! +=
        amplitude *
        envelope *
        0.5 *
        (Math.sin(2 * Math.PI * f * t + phase) + Math.sin(2 * Math.PI * f * detune * t + phase));
    }
  }
  // The knock: a short low burst of filtered noise.
  let low = 0;
  for (let i = 0; i < Math.min(out.length, Math.round(0.06 * sampleRate)); i++) {
    const t = i / sampleRate;
    low = low * 0.97 + (random() * 2 - 1) * 0.03;
    out[i]! += low * velocity * 2.5 * Math.exp(-t / 0.015);
  }
  return out;
}

/** Mixes tones into one signal: [midi, start in seconds, length in seconds, velocity]. */
export function performance(
  notes: readonly (readonly [number, number, number, number?])[],
  sampleRate: number,
  seconds: number,
  noise = 0.0005,
): Float32Array {
  const out = new Float32Array(Math.round(seconds * sampleRate));
  for (const [midi, start, length, velocity] of notes) {
    const tone = pianoTone(midi, sampleRate, length, velocity ?? 0.4);
    const at = Math.round(start * sampleRate);
    const release = Math.round(0.05 * sampleRate);
    for (let i = 0; i < tone.length && at + i < out.length; i++) {
      const fade = i > tone.length - release ? (tone.length - i) / release : 1;
      out[at + i]! += tone[i]! * fade;
    }
  }
  let seed = 99;
  for (let i = 0; i < out.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i]! += ((seed / 0x7fffffff) * 2 - 1) * noise;
  }
  return out;
}
