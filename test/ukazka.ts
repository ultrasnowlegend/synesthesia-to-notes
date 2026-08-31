import type { Scena } from './scena.js';

/**
 * Spolecna testovaci scena: 61 klaves, 120 BPM, melodie v prave ruce a
 * pulove tony v leve. Casy jsou zamerne presne na osminove mrizce, aby slo
 * merit i odhad tempa a kvantizaci.
 */
export function ukazkovaScena(barevneRuce: boolean): Scena {
  const doba = 0.5;
  const melodie = [72, 74, 76, 79, 76, 74, 72, 72];
  const bas = [48, 55, 48, 55];

  return {
    sirka: 1280,
    vyska: 720,
    fps: 30,
    delka: 6.5,
    hornihrana: 520,
    dolniHrana: 700,
    prvniMidi: 36,
    pocetBilych: 36,
    rychlost: 260,
    barevneRuce,
    noty: [
      ...melodie.map((midi, i) => ({
        midi,
        start: 1 + i * doba,
        konec: 1 + i * doba + doba * 0.8,
        ruka: 'prava' as const,
      })),
      ...bas.map((midi, i) => ({
        midi,
        start: 1 + i * doba * 2,
        konec: 1 + i * doba * 2 + doba * 1.8,
        ruka: 'leva' as const,
      })),
    ],
  };
}
