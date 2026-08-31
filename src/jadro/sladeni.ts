import { porovnejOnsety } from './onsety.js';
import type { Udalost } from './typy.js';

export interface Sladeni {
  /** O kolik sekund je treba posunout obrazove casy, aby sedly na zvuk. */
  posun: number;
  /** Podil obrazovych uderu, ke kterym po posunu existuje zvukovy. */
  presnost: number;
  /** Podil zvukovych uderu, ke kterym existuje obrazovy. */
  pokryti: number;
}

/** Casy zacatku, kde noty znejici zaroven tvori jeden uder. */
export function uderyZObrazu(udalosti: readonly Udalost[], tolerance = 0.05): number[] {
  const starty = udalosti.map((u) => u.start).sort((a, b) => a - b);
  const out: number[] = [];
  for (const t of starty) {
    const posledni = out[out.length - 1];
    if (posledni === undefined || t - posledni > tolerance) out.push(t);
  }
  return out;
}

/**
 * Najde konstantni posun mezi obrazem a zvukem. V nahravkach obrazovky nebyva
 * obraz a zvuk presne slazeny a rozdil byva i pres desetinu sekundy; hleda se
 * proto posun, pri kterem nejvic obrazovych uderu potka zvukovy.
 *
 * Vedlejsim produktem je mira duvery v detekci: obraz a zvuk jsou nezavisle
 * zdroje, takze vysoka shoda po posunu znamena, ze obraz cteme spravne.
 */
export function sladSeZvukem(
  udalosti: readonly Udalost[],
  zvukoveUdery: readonly number[],
  maxPosun = 0.5,
  tolerance = 0.05,
): Sladeni {
  const udery = uderyZObrazu(udalosti);
  if (udery.length < 10 || zvukoveUdery.length < 10) {
    return { posun: 0, presnost: 0, pokryti: 0 };
  }

  let nejlepsi: Sladeni = { posun: 0, presnost: 0, pokryti: 0 };
  for (let posun = -maxPosun; posun <= maxPosun + 1e-9; posun += 0.01) {
    const r = porovnejOnsety(
      udery.map((t) => t + posun),
      zvukoveUdery,
      tolerance,
    );
    if (r.presnost > nejlepsi.presnost) {
      nejlepsi = { posun, presnost: r.presnost, pokryti: r.pokryti };
    }
  }
  return nejlepsi;
}

/**
 * Prichyti zacatky not na nejblizsi zvukovy uder. Obraz ma pri 30 snimcich za
 * sekundu krok 33 ms, kdezto ze zvuku jde uder urcit s presnosti kolem 5 ms;
 * vysku tonu ale zvuk neurcuje nikdy, jen cas.
 */
export function upresniPodleZvuku(
  udalosti: Udalost[],
  zvukoveUdery: readonly number[],
  posun: number,
  tolerance = 0.04,
): number {
  if (zvukoveUdery.length === 0) return 0;
  const serazene = [...zvukoveUdery].sort((a, b) => a - b);

  const nejblizsi = (cas: number): number | null => {
    let od = 0;
    let doI = serazene.length - 1;
    while (od < doI) {
      const stred = (od + doI) >> 1;
      if (serazene[stred]! < cas) od = stred + 1;
      else doI = stred;
    }
    let nej = serazene[od]!;
    if (od > 0 && Math.abs(serazene[od - 1]! - cas) < Math.abs(nej - cas)) nej = serazene[od - 1]!;
    return Math.abs(nej - cas) <= tolerance ? nej : null;
  };

  let upresneno = 0;
  for (const u of udalosti) {
    const delka = u.konec - u.start;
    const posunuty = u.start + posun;
    const cil = nejblizsi(posunuty);
    u.start = cil ?? posunuty;
    u.konec = u.start + delka;
    if (cil !== null) upresneno++;
  }
  return upresneno;
}
