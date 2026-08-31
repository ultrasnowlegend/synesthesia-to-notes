import { ctiSyroveSnimky } from '../video/ffmpeg.js';

/**
 * Dekoduje zvukovou stopu na mono float vzorky. Vic nez 22 kHz nepotrebujeme —
 * hledaji se jen okamziky uderu, ne vysky tonu.
 */
export async function nactiVzorky(video: string, vzorkovani = 22050): Promise<Float32Array> {
  const kusy: Float32Array[] = [];
  const naKus = 1 << 16;
  await ctiSyroveSnimky(
    [
      '-v', 'error',
      '-i', video,
      '-vn',
      '-ac', '1',
      '-ar', String(vzorkovani),
      '-f', 'f32le',
      '-',
    ],
    naKus * 4,
    (data) => {
      kusy.push(new Float32Array(data.slice().buffer));
    },
  );

  let delka = 0;
  for (const k of kusy) delka += k.length;
  const out = new Float32Array(delka);
  let posun = 0;
  for (const k of kusy) {
    out.set(k, posun);
    posun += k.length;
  }
  return out;
}
