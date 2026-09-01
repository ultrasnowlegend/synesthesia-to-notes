import type { Scene } from './scene.js';

/**
 * The shared test scene: 61 keys, 120 BPM, a melody in the right hand and half
 * notes in the left. The times sit exactly on an eighth-note grid so the tempo
 * estimate and the quantisation can be measured too.
 */
export function sampleScene(coloredHands: boolean): Scene {
  const beat = 0.5;
  const melody = [72, 74, 76, 79, 76, 74, 72, 72];
  const bass = [48, 55, 48, 55];

  return {
    width: 1280,
    height: 720,
    fps: 30,
    duration: 6.5,
    topEdge: 520,
    bottomEdge: 700,
    firstMidi: 36,
    whiteCount: 36,
    speed: 260,
    coloredHands,
    notes: [
      ...melody.map((midi, i) => ({
        midi,
        start: 1 + i * beat,
        end: 1 + i * beat + beat * 0.8,
        hand: 'right' as const,
      })),
      ...bass.map((midi, i) => ({
        midi,
        start: 1 + i * beat * 2,
        end: 1 + i * beat * 2 + beat * 1.8,
        hand: 'left' as const,
      })),
    ],
  };
}
