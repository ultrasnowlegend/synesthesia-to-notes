/**
 * Detekce uderu ze zvuku spektralnim tokem. Slouzi jen jako druhy nazor:
 * rika, *kdy* se hralo, nikdy ne *co*. Vyska tonu se cte z obrazu.
 */

export interface NastaveniOnsetu {
  /** Vzorkovaci frekvence vstupniho signalu. */
  vzorkovani?: number;
  /** Delka okna FFT ve vzorcich; musi byt mocnina dvou. */
  okno?: number;
  /** Posun mezi okny ve vzorcich. */
  posun?: number;
  /** O kolik musi spicka prevysit klouzavy median, aby se brala jako uder. */
  citlivost?: number;
  /** Nejkratsi odstup dvou uderu v sekundach. */
  minOdstup?: number;
}

const VYCHOZI = {
  vzorkovani: 22050,
  okno: 1024,
  posun: 256,
  citlivost: 1.6,
  minOdstup: 0.045,
} as const;

/** Rychla Fourierova transformace na miste; delka musi byt mocnina dvou. */
function fft(re: Float64Array, im: Float64Array): void {
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

/**
 * Spektralni tok: soucet prirustku energie po frekvencnich pasmech. Ubytky se
 * zahazuji, protoze doznivajici ton neni novy uder.
 */
export function spektralniTok(
  vzorky: Float32Array,
  nastaveni: NastaveniOnsetu = {},
): { tok: Float32Array; krokSekund: number } {
  const okno = nastaveni.okno ?? VYCHOZI.okno;
  const posun = nastaveni.posun ?? VYCHOZI.posun;
  const vzorkovani = nastaveni.vzorkovani ?? VYCHOZI.vzorkovani;

  const hann = new Float64Array(okno);
  for (let i = 0; i < okno; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / okno);

  const pocetRamcu = Math.max(0, Math.floor((vzorky.length - okno) / posun) + 1);
  const tok = new Float32Array(pocetRamcu);
  const re = new Float64Array(okno);
  const im = new Float64Array(okno);
  let predchozi = new Float64Array(okno / 2);

  for (let r = 0; r < pocetRamcu; r++) {
    const zacatek = r * posun;
    for (let i = 0; i < okno; i++) {
      re[i] = (vzorky[zacatek + i] ?? 0) * hann[i]!;
      im[i] = 0;
    }
    fft(re, im);
    let soucet = 0;
    const aktualni = new Float64Array(okno / 2);
    for (let i = 0; i < okno / 2; i++) {
      const velikost = Math.hypot(re[i]!, im[i]!);
      aktualni[i] = velikost;
      const rozdil = velikost - predchozi[i]!;
      if (rozdil > 0) soucet += rozdil;
    }
    tok[r] = soucet;
    predchozi = aktualni;
  }

  return { tok, krokSekund: posun / vzorkovani };
}

function klouzavyMedian(hodnoty: Float32Array, polomer: number): Float32Array {
  const out = new Float32Array(hodnoty.length);
  const okno: number[] = [];
  for (let i = 0; i < hodnoty.length; i++) {
    okno.length = 0;
    for (let j = Math.max(0, i - polomer); j <= Math.min(hodnoty.length - 1, i + polomer); j++) {
      okno.push(hodnoty[j]!);
    }
    okno.sort((a, b) => a - b);
    out[i] = okno[okno.length >> 1]!;
  }
  return out;
}

/** Casy uderu v sekundach. */
export function najdiOnsety(vzorky: Float32Array, nastaveni: NastaveniOnsetu = {}): number[] {
  const { tok, krokSekund } = spektralniTok(vzorky, nastaveni);
  if (tok.length === 0) return [];

  const citlivost = nastaveni.citlivost ?? VYCHOZI.citlivost;
  const minOdstup = nastaveni.minOdstup ?? VYCHOZI.minOdstup;
  // Prah se pocita z klouzaveho medianu, aby hlasita i ticha mista mela stejnou
  // sanci; pevny prah by v tichem useku nenasel nic a v hlasitem vsechno.
  const median = klouzavyMedian(tok, Math.round(0.3 / krokSekund));

  const out: number[] = [];
  for (let i = 1; i < tok.length - 1; i++) {
    const v = tok[i]!;
    if (v <= tok[i - 1]! || v < tok[i + 1]!) continue;
    if (v < median[i]! * citlivost) continue;
    const cas = i * krokSekund;
    const posledni = out[out.length - 1];
    if (posledni !== undefined && cas - posledni < minOdstup) {
      if (v > tok[Math.round(posledni / krokSekund)]!) out[out.length - 1] = cas;
      continue;
    }
    out.push(cas);
  }
  return out;
}

/**
 * Podil obrazovych uderu, ke kterym se do dane tolerance nasel zvukovy, a naopak.
 * Slouzi jako mira duvery v detekci: obraz a zvuk jsou nezavisle zdroje, takze
 * kdyz se shoduji, chyba je nepravdepodobna.
 */
export function porovnejOnsety(
  zObrazu: readonly number[],
  zeZvuku: readonly number[],
  tolerance = 0.06,
): { pokryti: number; presnost: number } {
  if (zObrazu.length === 0 || zeZvuku.length === 0) return { pokryti: 0, presnost: 0 };
  const seradene = [...zeZvuku].sort((a, b) => a - b);

  const nejblizsi = (cas: number): number => {
    let od = 0;
    let doI = seradene.length - 1;
    while (od < doI) {
      const stred = (od + doI) >> 1;
      if (seradene[stred]! < cas) od = stred + 1;
      else doI = stred;
    }
    let nej = Math.abs(seradene[od]! - cas);
    if (od > 0) nej = Math.min(nej, Math.abs(seradene[od - 1]! - cas));
    return nej;
  };

  let sedi = 0;
  for (const cas of zObrazu) if (nejblizsi(cas) <= tolerance) sedi++;

  const obrazSerazene = [...zObrazu].sort((a, b) => a - b);
  let nalezene = 0;
  for (const cas of seradene) {
    let nej = Infinity;
    for (const o of obrazSerazene) {
      const d = Math.abs(o - cas);
      if (d < nej) nej = d;
      if (o > cas + tolerance) break;
    }
    if (nej <= tolerance) nalezene++;
  }

  return { presnost: sedi / zObrazu.length, pokryti: nalezene / seradene.length };
}
