import { useEffect, useState } from 'react';

import type { GridOptions, Summary, TranscribeInput } from '../../electron/shared.js';

interface Props {
  summary: Summary;
  grid: GridOptions;
  onGrid: (next: GridOptions) => void;
  onRerun: (input: TranscribeInput) => void;
  onNew: () => void;
}

const DIVISIONS = [
  { value: 1, label: 'čtvrťové' },
  { value: 2, label: 'osminové' },
  { value: 3, label: 'osminové trioly' },
  { value: 4, label: 'šestnáctinové' },
  { value: 6, label: 'šestnáctinové trioly' },
];

const TIME_SIGNATURES = ['4/4', '3/4', '2/4', '6/8', '5/4'];

function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}): React.JSX.Element {
  return (
    <div className="row">
      <label htmlFor={`s-${label}`}>{label}</label>
      <span className="value">
        {value.toFixed(step < 1 ? 2 : 0)}
        {unit ? ` ${unit}` : ''}
      </span>
      <input
        id={`s-${label}`}
        className="slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Result({ summary, grid, onGrid, onRerun, onNew }: Props): React.JSX.Element {
  const [page, setPage] = useState(1);
  const [svg, setSvg] = useState('');
  const [message, setMessage] = useState('');
  const [edges, setEdges] = useState<[number, number]>([summary.topEdge, summary.bottomEdge]);
  const [firstMidi, setFirstMidi] = useState(summary.firstMidi);
  const [threshold, setThreshold] = useState(summary.threshold);

  useEffect(() => {
    let alive = true;
    void window.app.page(Math.min(page, Math.max(1, summary.pages))).then((r) => {
      if (alive && r.ok && r.data) setSvg(r.data);
    });
    return () => {
      alive = false;
    };
  }, [page, summary.pages, summary.notes, summary.tempo.bpm]);

  const save = async (kind: 'midi' | 'musicxml' | 'pdf'): Promise<void> => {
    setMessage('');
    const r = await window.app.save(kind);
    if (r.ok && r.data) setMessage(`Uloženo: ${r.data}`);
    else if (!r.ok) setMessage(r.error ?? 'Uložení se nepodařilo.');
  };

  const syncClass =
    summary.sync.precision >= 0.85 ? 'good' : summary.sync.precision > 0 ? 'weak' : '';
  const fileName = summary.video.split(/[\\/]/).pop() ?? summary.video;

  return (
    <div className="result">
      <div className="topbar">
        <span className="name" title={summary.video}>
          {fileName}
        </span>
        <div className="chips">
          <span className="chip">
            <b>{summary.keys}</b> kláves
          </span>
          <span className="chip">
            <b>{summary.events}</b> not
          </span>
          <span className="chip">
            <b>{summary.keyName}</b>
          </span>
          <span className={`chip ${syncClass}`}>
            shoda se zvukem <b>{Math.round(summary.sync.precision * 100)} %</b>
          </span>
          <span className="chip">
            levá ruka{' '}
            <b>{Math.round((summary.leftHandNotes / Math.max(1, summary.events)) * 100)} %</b>
          </span>
          {summary.octaveShift !== 0 && (
            <span className="chip">
              oktáva opravena o <b>{summary.octaveShift}</b>
            </span>
          )}
        </div>
        <button onClick={onNew}>Jiné video</button>
      </div>

      <div className="body">
        <div className="panel">
          <div className="group">
            <h3>Mřížka</h3>
            <Slider
              label="Tempo"
              value={grid.bpm ?? summary.tempo.bpm}
              min={40}
              max={200}
              step={0.25}
              unit="BPM"
              onChange={(v) => onGrid({ ...grid, bpm: v })}
            />
            <Slider
              label="Posun"
              value={grid.offset ?? summary.tempo.offset}
              min={0}
              max={4}
              step={0.01}
              unit="s"
              onChange={(v) => onGrid({ ...grid, offset: v })}
            />
            <div className="row">
              <label htmlFor="division">Dělení doby</label>
              <select
                id="division"
                style={{ width: '11rem' }}
                value={grid.division ?? 4}
                onChange={(e) => onGrid({ ...grid, division: Number(e.target.value) })}
              >
                {DIVISIONS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="row">
              <label htmlFor="time">Takt</label>
              <select
                id="time"
                style={{ width: '11rem' }}
                value={`${grid.numerator ?? 4}/${grid.denominator ?? 4}`}
                onChange={(e) => {
                  const [n, d] = e.target.value.split('/');
                  onGrid({ ...grid, numerator: Number(n), denominator: Number(d) });
                }}
              >
                {TIME_SIGNATURES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <Slider
              label="Legato"
              value={grid.legato ?? 1}
              min={0}
              max={2}
              step={0.25}
              unit="doby"
              onChange={(v) => onGrid({ ...grid, legato: v })}
            />
            <p className="hint">
              Legato vyplní krátké mezery prodlouženým tónem místo pomlky. Nula zachová
              naměřené délky doslova, což u improvizace vede na les pomlk.
            </p>
          </div>

          <div className="group">
            <h3>Nalezené noty</h3>
            <img className="preview" src={summary.rollPreview} alt="Klavírní rolka nalezených not" />
            <p className="hint">
              Celá nahrávka, zlatě pravá ruka, zeleně levá. Vodorovné linky jsou C.
            </p>
          </div>

          <div className="group">
            <h3>Kalibrace</h3>
            <img
              className="preview"
              src={summary.calibrationPreview}
              alt="Klaviatura s vyznačenými klávesami"
            />
            <p className="hint">
              Značky musí ležet na klávesách a fialové svislice u každého C. Když nesedí,
              zadej hrany ručně a přepočítej.
            </p>
            <div className="row" style={{ marginTop: '0.7rem' }}>
              <label htmlFor="top">Horní hrana</label>
              <input
                id="top"
                type="number"
                style={{ width: '6rem' }}
                value={edges[0]}
                onChange={(e) => setEdges([Number(e.target.value), edges[1]])}
              />
            </div>
            <div className="row">
              <label htmlFor="bottom">Dolní hrana</label>
              <input
                id="bottom"
                type="number"
                style={{ width: '6rem' }}
                value={edges[1]}
                onChange={(e) => setEdges([edges[0], Number(e.target.value)])}
              />
            </div>
            <div className="row">
              <label htmlFor="first">Nejnižší bílá (MIDI)</label>
              <input
                id="first"
                type="number"
                style={{ width: '6rem' }}
                value={firstMidi}
                onChange={(e) => setFirstMidi(Number(e.target.value))}
              />
            </div>
            <Slider
              label="Práh detekce"
              value={threshold}
              min={0.05}
              max={0.5}
              step={0.01}
              onChange={setThreshold}
            />
            <button
              style={{ width: '100%', marginTop: '0.6rem' }}
              onClick={() =>
                onRerun({
                  keyboard: { topEdge: edges[0], bottomEdge: edges[1], firstMidi },
                  detection: { threshold },
                })
              }
            >
              Přepočítat z videa
            </button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateRows: '1fr auto', minHeight: 0 }}>
          <div className="score">
            <div className="sheet" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
          <div className="footer">
            <div className="pager">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                ←
              </button>
              <span>
                strana {Math.min(page, summary.pages)} z {summary.pages}
              </span>
              <button disabled={page >= summary.pages} onClick={() => setPage((p) => p + 1)}>
                →
              </button>
            </div>
            <span className="spacer" />
            {message && <span className="message">{message}</span>}
            <button onClick={() => void save('midi')}>Uložit MIDI</button>
            <button onClick={() => void save('musicxml')}>Uložit MusicXML</button>
            <button className="primary" onClick={() => void save('pdf')}>
              Uložit PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
