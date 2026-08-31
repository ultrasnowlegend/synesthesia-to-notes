import { useEffect, useRef, useState } from 'react';

import type { NastaveniMrizky, NastaveniPrepisuOkna, Souhrn } from '../../electron/sdilene.js';

interface Vlastnosti {
  souhrn: Souhrn;
  mrizka: NastaveniMrizky;
  naMrizku: (nova: NastaveniMrizky) => void;
  naZnovu: (nastaveni: NastaveniPrepisuOkna) => void;
  naNove: () => void;
}

const DELENI = [
  { hodnota: 1, popis: 'čtvrťové' },
  { hodnota: 2, popis: 'osminové' },
  { hodnota: 3, popis: 'osminové trioly' },
  { hodnota: 4, popis: 'šestnáctinové' },
  { hodnota: 6, popis: 'šestnáctinové trioly' },
];

const TAKTY = ['4/4', '3/4', '2/4', '6/8', '5/4'];

function Posuvnik({
  popis,
  hodnota,
  min,
  max,
  krok,
  jednotka,
  naZmenu,
}: {
  popis: string;
  hodnota: number;
  min: number;
  max: number;
  krok: number;
  jednotka?: string;
  naZmenu: (v: number) => void;
}): React.JSX.Element {
  return (
    <div className="radek">
      <label htmlFor={`p-${popis}`}>{popis}</label>
      <span className="hodnota">
        {hodnota.toFixed(krok < 1 ? 2 : 0)}
        {jednotka ? ` ${jednotka}` : ''}
      </span>
      <input
        id={`p-${popis}`}
        className="posuvnik"
        type="range"
        min={min}
        max={max}
        step={krok}
        value={hodnota}
        onChange={(e) => naZmenu(Number(e.target.value))}
      />
    </div>
  );
}

export function Vysledek({ souhrn, mrizka, naMrizku, naZnovu, naNove }: Vlastnosti): React.JSX.Element {
  const [strana, setStrana] = useState(1);
  const [svg, setSvg] = useState('');
  const [zprava, setZprava] = useState('');
  const [hrany, setHrany] = useState<[number, number]>([souhrn.hornihrana, souhrn.dolniHrana]);
  const [prvniMidi, setPrvniMidi] = useState(souhrn.prvniMidi);
  const [prah, setPrah] = useState(souhrn.prah);
  const casovac = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let platne = true;
    void window.aplikace.strana(Math.min(strana, Math.max(1, souhrn.stran))).then((o) => {
      if (platne && o.ok && o.data) setSvg(o.data);
    });
    return () => {
      platne = false;
    };
  }, [strana, souhrn.stran, souhrn.noty, souhrn.tempo.bpm]);

  /** Posuvniky prekresluji noty se zpozdenim, aby tazeni nezahltilo prepocet. */
  const zmen = (castecne: Partial<NastaveniMrizky>): void => {
    const nova = { ...mrizka, ...castecne };
    naMrizku(nova);
    if (casovac.current) clearTimeout(casovac.current);
  };

  const exportuj = async (typ: 'midi' | 'musicxml' | 'pdf'): Promise<void> => {
    setZprava('');
    const o = await window.aplikace.export(typ);
    if (o.ok && o.data) setZprava(`Uloženo: ${o.data}`);
    else if (!o.ok) setZprava(o.chyba ?? 'Uložení se nepodařilo.');
  };

  const shodaTrida = souhrn.sladeni.presnost >= 0.85 ? 'dobra' : souhrn.sladeni.presnost > 0 ? 'slaba' : '';
  const nazevSouboru = souhrn.video.split(/[\\/]/).pop() ?? souhrn.video;

  return (
    <div className="vysledek">
      <div className="zahlavi">
        <span className="nazev" title={souhrn.video}>
          {nazevSouboru}
        </span>
        <div className="cipy">
          <span className="cip">
            <b>{souhrn.klaves}</b> kláves
          </span>
          <span className="cip">
            <b>{souhrn.udalosti}</b> not
          </span>
          <span className="cip">
            <b>{souhrn.tonina}</b>
          </span>
          <span className={`cip ${shodaTrida}`}>
            shoda se zvukem <b>{Math.round(souhrn.sladeni.presnost * 100)} %</b>
          </span>
          <span className="cip">
            levá ruka <b>{Math.round((souhrn.levouRukou / Math.max(1, souhrn.udalosti)) * 100)} %</b>
          </span>
        </div>
        <button onClick={naNove}>Jiné video</button>
      </div>

      <div className="telo">
        <div className="panel">
          <div className="skupina">
            <h3>Mřížka</h3>
            <Posuvnik
              popis="Tempo"
              hodnota={mrizka.bpm ?? souhrn.tempo.bpm}
              min={40}
              max={200}
              krok={0.25}
              jednotka="BPM"
              naZmenu={(v) => zmen({ bpm: v })}
            />
            <Posuvnik
              popis="Posun"
              hodnota={mrizka.offset ?? souhrn.tempo.offset}
              min={0}
              max={4}
              krok={0.01}
              jednotka="s"
              naZmenu={(v) => zmen({ offset: v })}
            />
            <div className="radek">
              <label htmlFor="deleni">Dělení doby</label>
              <select
                id="deleni"
                style={{ width: '11rem' }}
                value={mrizka.deleni ?? 4}
                onChange={(e) => zmen({ deleni: Number(e.target.value) })}
              >
                {DELENI.map((d) => (
                  <option key={d.hodnota} value={d.hodnota}>
                    {d.popis}
                  </option>
                ))}
              </select>
            </div>
            <div className="radek">
              <label htmlFor="takt">Takt</label>
              <select
                id="takt"
                style={{ width: '11rem' }}
                value={`${mrizka.citatel ?? 4}/${mrizka.jmenovatel ?? 4}`}
                onChange={(e) => {
                  const [c, j] = e.target.value.split('/');
                  zmen({ citatel: Number(c), jmenovatel: Number(j) });
                }}
              >
                {TAKTY.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <Posuvnik
              popis="Legato"
              hodnota={mrizka.legato ?? 1}
              min={0}
              max={2}
              krok={0.25}
              jednotka="doby"
              naZmenu={(v) => zmen({ legato: v })}
            />
            <p className="napoveda">
              Legato vyplní krátké mezery prodlouženým tónem místo pomlky. Nula zachová
              naměřené délky doslova, což u improvizace vede na les pomlk.
            </p>
          </div>

          <div className="skupina">
            <h3>Nalezené noty</h3>
            <img className="nahled-obrazek" src={souhrn.nahledRolky} alt="Klavírní rolka nalezených not" />
            <p className="napoveda">
              Celá nahrávka, zlatě pravá ruka, zeleně levá. Vodorovné linky jsou C.
            </p>
          </div>

          <div className="skupina">
            <h3>Kalibrace</h3>
            <img className="nahled-obrazek" src={souhrn.nahledKalibrace} alt="Klaviatura s vyznačenými klávesami" />
            <p className="napoveda">
              Značky musí ležet na klávesách a fialové svislice u každého C. Když nesedí,
              zadej hrany ručně a přepočítej.
            </p>
            <div className="radek" style={{ marginTop: '0.7rem' }}>
              <label htmlFor="horni">Horní hrana</label>
              <input
                id="horni"
                type="number"
                style={{ width: '6rem' }}
                value={hrany[0]}
                onChange={(e) => setHrany([Number(e.target.value), hrany[1]])}
              />
            </div>
            <div className="radek">
              <label htmlFor="dolni">Dolní hrana</label>
              <input
                id="dolni"
                type="number"
                style={{ width: '6rem' }}
                value={hrany[1]}
                onChange={(e) => setHrany([hrany[0], Number(e.target.value)])}
              />
            </div>
            <div className="radek">
              <label htmlFor="prvni">Nejnižší bílá (MIDI)</label>
              <input
                id="prvni"
                type="number"
                style={{ width: '6rem' }}
                value={prvniMidi}
                onChange={(e) => setPrvniMidi(Number(e.target.value))}
              />
            </div>
            <Posuvnik
              popis="Práh detekce"
              hodnota={prah}
              min={0.05}
              max={0.5}
              krok={0.01}
              naZmenu={setPrah}
            />
            <button
              style={{ width: '100%', marginTop: '0.6rem' }}
              onClick={() =>
                naZnovu({
                  klaviatura: { hornihrana: hrany[0], dolniHrana: hrany[1], prvniMidi },
                  detekce: { prah },
                })
              }
            >
              Přepočítat z videa
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateRows: '1fr auto', minHeight: 0 }}>
          <div className="noty">
            <div className="list" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
          <div className="zapati">
            <div className="strankovani">
              <button disabled={strana <= 1} onClick={() => setStrana((s) => s - 1)}>
                ←
              </button>
              <span>
                strana {Math.min(strana, souhrn.stran)} z {souhrn.stran}
              </span>
              <button disabled={strana >= souhrn.stran} onClick={() => setStrana((s) => s + 1)}>
                →
              </button>
            </div>
            <span className="mezera" />
            {zprava && <span className="zprava">{zprava}</span>}
            <button onClick={() => void exportuj('midi')}>Uložit MIDI</button>
            <button onClick={() => void exportuj('musicxml')}>Uložit MusicXML</button>
            <button className="hlavni" onClick={() => void exportuj('pdf')}>
              Uložit PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
