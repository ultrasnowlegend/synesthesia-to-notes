/**
 * Mereni prepisu proti referenci. Pouziva se bezna miry z prepisu hudby:
 * nota se pocita za nalezenou, kdyz sedi vyska tonu presne a zacatek do dane
 * tolerance. Konce not se zamerne neposuzuji — u videa je delka dana tim, jak
 * dlouho sviti pruh, kdezto v MIDI tim, kdy se pusti klavesa, a to jsou dve
 * ruzne veci.
 */

export interface JednaNota {
  midi: number;
  start: number;
}

export interface Mira {
  /** Podil nalezenych not, ktere maji protejsek v referenci. */
  presnost: number;
  /** Podil referencnich not, ktere se podarilo najit. */
  uplnost: number;
  f1: number;
  sedi: number;
  nalezeno: number;
  referencnich: number;
  /** Prumerna odchylka zacatku u sedicich not, v sekundach. */
  odchylkaCasu: number;
}

/**
 * Kazde referencni note prirazuje nejblizsi dosud nespotrebovanou nalezenou
 * notu stejne vysky. Prirazeni je hladove, ne optimalni, ale pri tolerancich
 * pod desetinu sekundy se lisi jen v jednotkach not.
 */
export function porovnejNoty(
  nalezene: readonly JednaNota[],
  referencni: readonly JednaNota[],
  tolerance = 0.05,
): Mira {
  const podleVysky = new Map<number, { start: number; pouzito: boolean }[]>();
  for (const n of nalezene) {
    const seznam = podleVysky.get(n.midi);
    const zaznam = { start: n.start, pouzito: false };
    if (seznam) seznam.push(zaznam);
    else podleVysky.set(n.midi, [zaznam]);
  }
  for (const seznam of podleVysky.values()) seznam.sort((a, b) => a.start - b.start);

  let sedi = 0;
  let soucetOdchylek = 0;
  for (const r of [...referencni].sort((a, b) => a.start - b.start)) {
    const seznam = podleVysky.get(r.midi);
    if (!seznam) continue;
    let nejlepsi = -1;
    let nejmensi = tolerance;
    for (let i = 0; i < seznam.length; i++) {
      const kandidat = seznam[i]!;
      if (kandidat.pouzito) continue;
      const rozdil = Math.abs(kandidat.start - r.start);
      if (rozdil <= nejmensi) {
        nejmensi = rozdil;
        nejlepsi = i;
      }
    }
    if (nejlepsi >= 0) {
      seznam[nejlepsi]!.pouzito = true;
      sedi++;
      soucetOdchylek += nejmensi;
    }
  }

  const presnost = nalezene.length ? sedi / nalezene.length : 0;
  const uplnost = referencni.length ? sedi / referencni.length : 0;
  return {
    presnost,
    uplnost,
    f1: presnost + uplnost ? (2 * presnost * uplnost) / (presnost + uplnost) : 0,
    sedi,
    nalezeno: nalezene.length,
    referencnich: referencni.length,
    odchylkaCasu: sedi ? soucetOdchylek / sedi : 0,
  };
}

/**
 * Najde posun, pri kterem prepis nejlepe sedi na referenci. Video zacina
 * jindy nez skladba — u tutorialu byva na zacatku odpocet — takze bez tohohle
 * kroku by neseděla ani spravne prectena nota.
 */
export function najdiPosunKReferenci(
  nalezene: readonly JednaNota[],
  referencni: readonly JednaNota[],
  maxPosun = 20,
  krok = 0.02,
  tolerance = 0.05,
): { posun: number; mira: Mira } {
  let nejlepsi = { posun: 0, mira: porovnejNoty(nalezene, referencni, tolerance) };
  for (let posun = -maxPosun; posun <= maxPosun + 1e-9; posun += krok) {
    const posunute = nalezene.map((n) => ({ midi: n.midi, start: n.start + posun }));
    const mira = porovnejNoty(posunute, referencni, tolerance);
    if (mira.f1 > nejlepsi.mira.f1) nejlepsi = { posun, mira };
  }
  return nejlepsi;
}
