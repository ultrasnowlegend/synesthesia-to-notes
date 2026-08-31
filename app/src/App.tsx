import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  NastaveniMrizky,
  NastaveniPrepisuOkna,
  Souhrn,
} from '../electron/sdilene.js';
import { Prubeh } from './obrazovky/Prubeh.js';
import { Uvod } from './obrazovky/Uvod.js';
import { Vysledek } from './obrazovky/Vysledek.js';

export type Stav = 'uvod' | 'prubeh' | 'vysledek';

const VYCHOZI_MRIZKA: NastaveniMrizky = { deleni: 4, citatel: 4, jmenovatel: 4, legato: 1 };

export function App(): React.JSX.Element {
  const [stav, setStav] = useState<Stav>('uvod');
  const [cesta, setCesta] = useState('');
  const [radky, setRadky] = useState<string[]>([]);
  const [souhrn, setSouhrn] = useState<Souhrn | null>(null);
  const [mrizka, setMrizka] = useState<NastaveniMrizky>(VYCHOZI_MRIZKA);
  const [chyba, setChyba] = useState('');
  const rucni = useRef<NastaveniPrepisuOkna>({});

  useEffect(() => window.aplikace.naStav((z) => setRadky((r) => [...r, z])), []);

  const spust = useCallback(
    async (soubor: string, nastaveni: NastaveniPrepisuOkna, novaMrizka: NastaveniMrizky) => {
      rucni.current = nastaveni;
      setCesta(soubor);
      setRadky([]);
      setChyba('');
      setStav('prubeh');
      const odpoved = await window.aplikace.prepis(soubor, { ...nastaveni, ...novaMrizka });
      if (odpoved.ok && odpoved.data) {
        // Odhadnute tempo se stava vychozi hodnotou ovladacu, aby posuvnik
        // zacinal tam, kde skoncil odhad, a ne na nahodne konstante.
        setMrizka({ ...novaMrizka, bpm: odpoved.data.tempo.bpm, offset: odpoved.data.tempo.offset });
        setSouhrn(odpoved.data);
        setStav('vysledek');
      } else {
        setChyba(odpoved.chyba ?? 'Prepis se nepodaril.');
        setStav('uvod');
      }
    },
    [],
  );

  const prekvantuj = useCallback(async (nova: NastaveniMrizky) => {
    setMrizka(nova);
    const odpoved = await window.aplikace.prekvantuj(nova);
    if (odpoved.ok && odpoved.data) {
      // Nahledy se pri prekvantovani neposilaji znovu; drzime ty puvodni.
      setSouhrn((s) =>
        s
          ? { ...odpoved.data!, nahledKalibrace: s.nahledKalibrace, nahledRolky: s.nahledRolky }
          : (odpoved.data ?? null),
      );
    }
  }, []);

  if (stav === 'prubeh') return <Prubeh cesta={cesta} radky={radky} />;
  if (stav === 'vysledek' && souhrn) {
    return (
      <Vysledek
        souhrn={souhrn}
        mrizka={mrizka}
        naMrizku={prekvantuj}
        naZnovu={(n) => void spust(cesta, n, mrizka)}
        naNove={() => setStav('uvod')}
      />
    );
  }
  return <Uvod chyba={chyba} naVideo={(s) => void spust(s, {}, VYCHOZI_MRIZKA)} />;
}
