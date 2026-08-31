import { jas } from './barvy.js';
import { median, otsu, radek, useky, type Obraz, type Usek } from './obraz.js';
import type { GeometrieKlaviatury, Klavesa } from './typy.js';

export interface NastaveniKlaviatury {
  /** Rucni prepis pasu klaviatury, kdyz automatika selze. */
  hornihrana?: number;
  dolniHrana?: number;
  /** Rucni prepis MIDI cisla nejlevejsi bile klavesy. */
  prvniMidi?: number;
  /** Odstup druheho radku nad klaviaturou, jako podil vysky obrazu. */
  odstupVyssiho?: number;
}

/** Poloton bileho tonu v ramci oktavy: C D E F G A H. */
const POLOTONY = [0, 2, 4, 5, 7, 9, 11] as const;
/** Ma za bilym tonem dane tridy nasledovat cerna klavesa? Za E a H ne. */
const NASLEDUJE_CERNA = [true, true, false, true, true, true, false] as const;

/**
 * Bezne velikosti klaviatur. Odvozeni oktavy podle stredu rozsahu dava u 61
 * klaves remizu mezi C1 a C2, takze standardni rozlozeni urcujeme napevno.
 */
const ZNAME_ROZLOZENI: Record<string, number> = {
  '52:5': 21, // 88 klaves, A0
  '44:2': 28, // 76 klaves, E1
  '36:0': 36, // 61 klaves, C2
  '29:0': 36, // 49 klaves, C2
  '22:0': 48, // 37 klaves, C3
  '15:0': 48, // 25 klaves, C3
};

interface PasKlaviatury {
  hornihrana: number;
  dolniHrana: number;
  radekBilych: number;
  radekCernych: number;
  radekDopadu: number;
}

/** MIDI cislo i-te bile klavesy zleva. */
function midiBileho(prvniMidi: number, posun: number, i: number): number {
  const trida = (posun + i) % 7;
  const oktava = Math.floor((posun + i) / 7);
  return prvniMidi - POLOTONY[posun]! + POLOTONY[trida]! + 12 * oktava;
}

/**
 * Najde vodorovny pas, ve kterem lezi klaviatura. Vychazi z toho, ze telo bilych
 * klaves je nejsvetlejsi souvisla plocha v dolni casti obrazu a ze nad i pod
 * klaviaturou je vyrazne tmavsi okoli.
 *
 * Hranice svetla se neurcuje konstantou, ale Otsuovou metodou nad celym
 * snimkem: pri teplem nasviceni jsou bile klavesy jantarove a mnohem tmavsi,
 * nez by cekala jakakoli pevna mez.
 */
function najdiPas(obraz: Obraz, nastaveni: NastaveniKlaviatury): PasKlaviatury {
  const { sirka, vyska } = obraz;
  const podilSvetlych = new Array<number>(vyska).fill(0);
  const podilTmavych = new Array<number>(vyska).fill(0);
  const krok = Math.max(1, Math.floor(sirka / 400));

  const vzorekJasu: number[] = [];
  for (let y = 0; y < vyska; y += 3) {
    for (let x = 0; x < sirka; x += krok) {
      const i = (y * sirka + x) * 3;
      vzorekJasu.push(jas({ r: obraz.data[i]!, g: obraz.data[i + 1]!, b: obraz.data[i + 2]! }));
    }
  }
  const prahJasu = Math.min(170, Math.max(45, otsu(vzorekJasu)));

  for (let y = 0; y < vyska; y++) {
    let svetle = 0;
    let pocet = 0;
    for (let x = 0; x < sirka; x += krok) {
      const i = (y * sirka + x) * 3;
      const b = { r: obraz.data[i]!, g: obraz.data[i + 1]!, b: obraz.data[i + 2]! };
      if (jas(b) > prahJasu) svetle++;
      pocet++;
    }
    podilSvetlych[y] = svetle / pocet;
    podilTmavych[y] = 1 - svetle / pocet;
  }

  const odRadku = Math.floor(vyska * 0.35);
  let maxSvetlosti = 0;
  for (let y = odRadku; y < vyska; y++) maxSvetlosti = Math.max(maxSvetlosti, podilSvetlych[y]!);
  const prah = Math.max(0.2, maxSvetlosti * 0.3);

  let hornihrana: number;
  let dolniHrana: number;

  if (nastaveni.hornihrana !== undefined && nastaveni.dolniHrana !== undefined) {
    hornihrana = nastaveni.hornihrana;
    dolniHrana = nastaveni.dolniHrana;
  } else {
    if (maxSvetlosti < 0.3) {
      throw new Error(
        'Klaviaturu se nepodarilo najit automaticky. Zadej hornihranu a dolniHranu rucne.',
      );
    }

    // Nejdelsi souvisly usek svetlych radku, ne rozrustani od nejsvetlejsiho:
    // v pruhu tesne nad klaviaturou byva jasna zar dopadu, ktera je svetlejsi
    // nez klavesy same, a rozrustani od ni by se zastavilo hned pod ni,
    // u nejsirsi casti cernych klaves.
    hornihrana = 0;
    dolniHrana = 0;
    let od = -1;
    for (let y = odRadku; y <= vyska; y++) {
      const nad = y < vyska && podilSvetlych[y]! > prah;
      if (nad && od < 0) od = y;
      if (!nad && od >= 0) {
        if (y - od > dolniHrana - hornihrana) {
          hornihrana = od;
          dolniHrana = y - 1;
        }
        od = -1;
      }
    }
  }

  const vysk = dolniHrana - hornihrana;
  if (vysk < 8) throw new Error(`Pas klaviatury je prilis tenky (${vysk} px).`);

  // Bile klavesy vzorkujeme v dolni tretine pasu, kam uz zadna cerna nezasahuje.
  let radekBilych = dolniHrana - Math.round(vysk * 0.12);
  let nejSvetlejsi = -1;
  for (let y = hornihrana + Math.round(vysk * 0.7); y < dolniHrana; y++) {
    if (podilSvetlych[y]! > nejSvetlejsi) {
      nejSvetlejsi = podilSvetlych[y]!;
      radekBilych = y;
    }
  }

  // Cerne klavesy zabiraji vzdy horni cast klaviatury, takze radek volime pevnym
  // podilem vysky. Hledani nejtmavsiho radku by sklouzlo nize, kde uz lezi ruce:
  // v medianu sice vetsinou zmizi, ale kdyz se hraje dlouho na jednom miste,
  // zbytek ruky by cerne klavesy slepil dohromady.
  const radekCernych = hornihrana + Math.round(vysk * 0.18);

  // Nad klaviaturou casto lezi jasna zar dopadu, ktera sviti porad; radek pro
  // detekci pruhu musi byt nad ni, jinak by byl trvale prosvetleny. Preskocime
  // proto vsechny svetle radky a jeste kus klidneho pasu nad nimi.
  let klid = 0;
  let y = hornihrana - 1;
  while (y > 0 && klid < 5) {
    klid = podilSvetlych[y]! > prah ? 0 : klid + 1;
    y--;
  }
  const dnoKlidu = y + klid;
  const radekDopadu = Math.max(0, dnoKlidu - Math.max(2, Math.round(vysk * 0.04)));

  return { hornihrana, dolniHrana, radekBilych, radekCernych, radekDopadu };
}

/** Odfiltruje useky, ktere jsou proti medianu neumerne uzke nebo siroke. */
function rozumneUseky(vsechny: Usek[], dolniPomer: number, horniPomer: number): Usek[] {
  if (vsechny.length === 0) return [];
  const m = median(vsechny.map((u) => u.sirka));
  return vsechny.filter((u) => u.sirka >= m * dolniPomer && u.sirka <= m * horniPomer);
}

/**
 * Bile klavesy maji na klaviatuře pravidelnou rozteč, takze misto surovych useku
 * z obrazu prokladame jejich stredy primkou a klavesy generujeme z ni.
 *
 * Bez toho staci jediny stin nebo zbytek ruky v medianu, ktery jednu klavesu
 * rozpulci nebo zahodi, a vsechny klavesy za nim se posunou o jednu — vzor
 * cernych klaves pak prestane sedet a polovina cernych se zahodi jako neplatna.
 * Navic takhle vzniknou i klavesy oriznute okrajem zaberu, ktere by jinak
 * propadly filtrem sirky.
 */
function mrizkaBilych(useky: readonly Usek[], sirka: number): Usek[] {
  const stredy = useky.map((u) => u.stred).sort((a, b) => a - b);
  if (stredy.length < 8) return [...useky];

  const rozdily: number[] = [];
  for (let i = 1; i < stredy.length; i++) rozdily.push(stredy[i]! - stredy[i - 1]!);
  const hrubyRozestup = median(rozdily);
  const sousedni = rozdily.filter((d) => d > hrubyRozestup * 0.7 && d < hrubyRozestup * 1.3);
  const rozestup = sousedni.length >= 4 ? median(sousedni) : hrubyRozestup;
  if (!(rozestup > 1)) return [...useky];

  // Nejmensi ctverce pres (index, stred); indexy vychazi ze zaokrouhleneho
  // podilu, takze vypadle klavesy nikoho neposunou.
  const prvni = stredy[0]!;
  const indexy = stredy.map((c) => Math.round((c - prvni) / rozestup));
  const n = stredy.length;
  const soucetI = indexy.reduce((s, i) => s + i, 0);
  const soucetC = stredy.reduce((s, c) => s + c, 0);
  const soucetII = indexy.reduce((s, i) => s + i * i, 0);
  const soucetIC = indexy.reduce((s, i, k) => s + i * stredy[k]!, 0);
  const jmenovatel = n * soucetII - soucetI * soucetI;
  if (jmenovatel === 0) return [...useky];
  const krok = (n * soucetIC - soucetI * soucetC) / jmenovatel;
  const posun = (soucetC - krok * soucetI) / n;

  const out: Usek[] = [];
  const odIndexu = Math.ceil((0 - krok / 2 - posun) / krok);
  const doIndexu = Math.floor((sirka - 1 + krok / 2 - posun) / krok);
  for (let i = odIndexu; i <= doIndexu; i++) {
    const stred = posun + krok * i;
    const x1 = Math.max(0, Math.round(stred - krok / 2));
    const x2 = Math.min(sirka - 1, Math.round(stred + krok / 2) - 1);
    if (x2 - x1 < krok * 0.25) continue;
    out.push({ x1, x2, sirka: x2 - x1 + 1, stred });
  }
  return out;
}

/**
 * Cerne klavesy tvori opakovany vzor 2-3, ktery jednoznacne urcuje, ktera bila
 * klavesa je C. Vraci polotonovou tridu nejlevejsi bile klavesy (0 = C, 6 = H).
 */
function urciPosun(maCernou: readonly boolean[]): number {
  let nejlepsi = 0;
  let nejlepsiSkore = -1;
  for (let posun = 0; posun < 7; posun++) {
    let skore = 0;
    for (let i = 0; i < maCernou.length; i++) {
      if (maCernou[i] === NASLEDUJE_CERNA[(posun + i) % 7]) skore++;
    }
    if (skore > nejlepsiSkore) {
      nejlepsiSkore = skore;
      nejlepsi = posun;
    }
  }
  return nejlepsi;
}

/** MIDI cislo nejlevejsi bile klavesy. */
function urciPrvniMidi(pocetBilych: number, posun: number): number {
  const znama = ZNAME_ROZLOZENI[`${pocetBilych}:${posun}`];
  if (znama !== undefined) return znama;

  // Fallback: oktavu volime tak, aby stred klaviatury lezel co nejbliz c1.
  let nejlepsi = 12 * 4 + POLOTONY[posun]!;
  let nejlepsiVzdalenost = Infinity;
  for (let oktava = 0; oktava <= 8; oktava++) {
    const prvni = 12 * oktava + POLOTONY[posun]!;
    const posledni = midiBileho(prvni, posun, pocetBilych - 1);
    const vzdalenost = Math.abs((prvni + posledni) / 2 - 60);
    if (vzdalenost < nejlepsiVzdalenost) {
      nejlepsiVzdalenost = vzdalenost;
      nejlepsi = prvni;
    }
  }
  return nejlepsi;
}

/** Index bile klavesy, ktera lezi vlevo od dane souradnice. */
function bilaVlevo(bile: readonly Usek[], x: number): number {
  let index = -1;
  for (let i = 0; i < bile.length; i++) {
    if (bile[i]!.stred < x) index = i;
    else break;
  }
  return index;
}

/**
 * Odecte geometrii klaviatury z klidoveho snimku (nejlepe medianu videa).
 * Vysledek je jedina vec, kterou dalsi kroky o obrazu potrebuji vedet.
 */
export function najdiKlaviaturu(
  obraz: Obraz,
  nastaveni: NastaveniKlaviatury = {},
): GeometrieKlaviatury {
  const pas = najdiPas(obraz, nastaveni);

  const bileRadek = radek(obraz, pas.radekBilych).map(jas);
  const prahBile = otsu(bileRadek);
  const nalezene = rozumneUseky(
    useky(obraz.sirka, (x) => bileRadek[x]! > prahBile),
    0.45,
    1.8,
  );
  if (nalezene.length < 7) {
    throw new Error(`Nalezeno jen ${nalezene.length} bilych klaves; klaviaturu nelze precist.`);
  }
  const bile = mrizkaBilych(nalezene, obraz.sirka);

  const cernyRadek = radek(obraz, pas.radekCernych).map(jas);
  const prahCerne = otsu(cernyRadek);
  const sirkaBile = median(bile.map((u) => u.sirka));
  const cerne = useky(obraz.sirka, (x) => cernyRadek[x]! < prahCerne).filter(
    (u) => u.sirka > sirkaBile * 0.3 && u.sirka < sirkaBile * 1.2,
  );

  // Ke kazde mezere mezi bilymi klavesami zjistime, jestli v ni lezi cerna.
  const maCernou = new Array<boolean>(bile.length - 1).fill(false);
  for (const c of cerne) {
    const index = bilaVlevo(bile, c.stred);
    if (index >= 0 && index < maCernou.length) maCernou[index] = true;
  }

  const posun = urciPosun(maCernou);
  const prvniMidi = nastaveni.prvniMidi ?? urciPrvniMidi(bile.length, posun);

  const klavesy: Klavesa[] = [];
  const midiBile: number[] = [];
  for (let i = 0; i < bile.length; i++) {
    const midi = midiBileho(prvniMidi, posun, i);
    midiBile.push(midi);
    const u = bile[i]!;
    klavesy.push({ midi, cerna: false, x1: u.x1, x2: u.x2, stred: u.stred, vx1: u.x1, vx2: u.x2 });
  }

  for (const c of cerne) {
    const index = bilaVlevo(bile, c.stred);
    if (index < 0 || index >= bile.length - 1) continue;
    // Cernou pripustime jen tam, kde ji vzor klaviatury opravdu ceka; jinak
    // by tenka delici cara mezi E a F vyrobila neexistujici klavesu.
    if (!NASLEDUJE_CERNA[(posun + index) % 7]) continue;
    klavesy.push({
      midi: midiBile[index]! + 1,
      cerna: true,
      x1: c.x1,
      x2: c.x2,
      stred: c.stred,
      vx1: c.x1,
      vx2: c.x2,
    });
  }

  klavesy.sort((a, b) => a.midi - b.midi);
  urciVyhradniRozsahy(klavesy);

  const radekDopadu = pas.radekDopadu;
  const vyskaPasu = pas.dolniHrana - pas.hornihrana;
  const odstupVyssiho = Math.round(obraz.vyska * (nastaveni.odstupVyssiho ?? 0.06));
  return {
    sirkaObrazu: obraz.sirka,
    vyskaObrazu: obraz.vyska,
    hornihrana: pas.hornihrana,
    dolniHrana: pas.dolniHrana,
    radekBilych: pas.radekBilych,
    radekCernych: pas.radekCernych,
    radekZare: Math.min(obraz.vyska - 1, pas.hornihrana + Math.max(4, Math.round(vyskaPasu * 0.06))),
    radekHloubky: Math.min(obraz.vyska - 1, pas.hornihrana + Math.max(14, Math.round(vyskaPasu * 0.3))),
    radekDopadu,
    radekVyssi: Math.max(0, radekDopadu - Math.max(12, odstupVyssiho)),
    klavesy,
  };
}

/**
 * Radky, ktere se ctou z kazdeho snimku. Kolem kazde zony jsou tri sousedni
 * radky, aby jednotliva vadna radka nebo artefakt komprese nerozhodily prumer.
 */
export function potrebneRadky(g: GeometrieKlaviatury): number[] {
  const zony = [g.radekDopadu, g.radekZare, g.radekHloubky];
  const radky = new Set<number>();
  for (const stred of zony) {
    for (const posun of [-2, 0, 2]) {
      radky.add(Math.max(0, Math.min(g.vyskaObrazu - 1, stred + posun)));
    }
  }
  return [...radky].sort((a, b) => a - b);
}

/** Ke kazde zone indexy do pole vracenych radku. */
export function zonyRadku(g: GeometrieKlaviatury): {
  dopad: number[];
  zar: number[];
  hloubka: number[];
} {
  const radky = potrebneRadky(g);
  const indexy = (stred: number): number[] =>
    [-2, 0, 2]
      .map((p) => radky.indexOf(Math.max(0, Math.min(g.vyskaObrazu - 1, stred + p))))
      .filter((i) => i >= 0);
  return {
    dopad: indexy(g.radekDopadu),
    zar: indexy(g.radekZare),
    hloubka: indexy(g.radekHloubky),
  };
}

/**
 * Ke kazde klavese doplni pruh, ktery nesdili s zadnou jinou. Cerna klavesa lezi
 * v obraze uvnitr sirky obou sousednich bilych, takze pruh bile klavesy prekryje
 * i sloupec cerne; kdyby se vzorkovala cela sirka, kazdy ton na bile klavese by
 * vyrobil falesny ton na sousedni cerne.
 */
function urciVyhradniRozsahy(klavesy: Klavesa[]): void {
  const cerne = klavesy.filter((k) => k.cerna);
  for (const k of klavesy) {
    if (k.cerna) {
      k.vx1 = k.x1;
      k.vx2 = k.x2;
      continue;
    }
    let segmenty: [number, number][] = [[k.x1, k.x2]];
    for (const c of cerne) {
      const dalsi: [number, number][] = [];
      for (const [a, b] of segmenty) {
        if (c.x2 < a || c.x1 > b) {
          dalsi.push([a, b]);
          continue;
        }
        if (c.x1 > a) dalsi.push([a, c.x1 - 1]);
        if (c.x2 < b) dalsi.push([c.x2 + 1, b]);
      }
      segmenty = dalsi;
    }
    if (segmenty.length === 0) {
      k.vx1 = k.x1;
      k.vx2 = k.x2;
      continue;
    }
    const nejsirsi = segmenty.reduce((n, s) => (s[1] - s[0] > n[1] - n[0] ? s : n));
    k.vx1 = nejsirsi[0];
    k.vx2 = nejsirsi[1];
  }
}
