import { useEffect, useRef } from 'react';

interface Props {
  path: string;
  lines: string[];
}

export function Progress({ path, lines }: Props): React.JSX.Element {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [lines]);

  return (
    <div className="progress">
      <div className="progress-inner">
        <h2>Přepisuji…</h2>
        <p className="file">{path}</p>
        <div className="log">
          {lines.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
          <div ref={end} />
        </div>
      </div>
    </div>
  );
}
