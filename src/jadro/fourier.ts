/** Rychla Fourierova transformace na miste; delka musi byt mocnina dvou. */
export function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j]!, re[i]!];
      [im[i], im[j]] = [im[j]!, im[i]!];
    }
  }
  for (let delka = 2; delka <= n; delka <<= 1) {
    const uhel = (-2 * Math.PI) / delka;
    const wRe = Math.cos(uhel);
    const wIm = Math.sin(uhel);
    for (let i = 0; i < n; i += delka) {
      let cRe = 1;
      let cIm = 0;
      for (let j = 0; j < delka / 2; j++) {
        const aRe = re[i + j]!;
        const aIm = im[i + j]!;
        const bRe = re[i + j + delka / 2]! * cRe - im[i + j + delka / 2]! * cIm;
        const bIm = re[i + j + delka / 2]! * cIm + im[i + j + delka / 2]! * cRe;
        re[i + j] = aRe + bRe;
        im[i + j] = aIm + bIm;
        re[i + j + delka / 2] = aRe - bRe;
        im[i + j + delka / 2] = aIm - bIm;
        const dalsiRe = cRe * wRe - cIm * wIm;
        cIm = cRe * wIm + cIm * wRe;
        cRe = dalsiRe;
      }
    }
  }
}

