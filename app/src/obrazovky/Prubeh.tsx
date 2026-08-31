import { useEffect, useRef } from 'react';

interface Vlastnosti {
  cesta: string;
  radky: string[];
}

export function Prubeh({ cesta, radky }: Vlastnosti): React.JSX.Element {
  const konec = useRef<HTMLDivElement>(null);
  useEffect(() => konec.current?.scrollIntoView({ block: 'end' }), [radky]);

  return (
    <div className="prubeh">
      <div className="prubeh-vnitrek">
        <h2>Přepisuji…</h2>
        <p className="soubor">{cesta}</p>
        <div className="log">
          {radky.map((r, i) => (
            <div key={i}>{r}</div>
          ))}
          <div ref={konec} />
        </div>
      </div>
    </div>
  );
}
