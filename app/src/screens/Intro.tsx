import { useState } from 'react';

interface Props {
  error: string;
  onVideo: (path: string) => void;
  onScore: (path?: string) => void;
}

const SCORE_EXTENSIONS = /\.(musicxml|xml|mxl|mei|mid|midi|abc)$/i;

export function Intro({ error, onVideo, onScore }: Props): React.JSX.Element {
  const [overZone, setOverZone] = useState(false);

  const pick = async (): Promise<void> => {
    const reply = await window.app.pickVideo();
    if (reply.ok && reply.data) onVideo(reply.data);
  };

  return (
    <div className="intro">
      <div className="intro-card">
        <h1>Z videa zpět do not</h1>
        <p>
          Nahrávka klavíru s padajícími pruhy v sobě noty už obsahuje — jen v obraze místo
          v zápisu. Přetáhni video sem a nech si ho přepsat. Pak z not rovnou hraj: aplikace
          poslouchá, barví zahrané noty a otáčí stránky za tebe.
        </p>
        <div
          className={`dropzone${overZone ? ' active' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOverZone(true);
          }}
          onDragLeave={() => setOverZone(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOverZone(false);
            const file = e.dataTransfer.files[0];
            if (!file) return;
            // Scores dropped here open for playing; anything else is a video.
            if (SCORE_EXTENSIONS.test(file.name)) onScore(window.app.filePath(file));
            else onVideo(window.app.filePath(file));
          }}
        >
          <p style={{ marginBottom: '1.2rem' }}>Přetáhni sem soubor s videem</p>
          <button className="primary" onClick={() => void pick()}>
            Vybrat video…
          </button>
        </div>
        <div className="intro-alt">
          <span>Máš už noty?</span>
          <button onClick={() => onScore()}>Otevřít noty a hrát…</button>
          <span className="formats">MusicXML, MXL, MEI, ABC nebo MIDI</span>
        </div>
        {error && <p className="error" style={{ marginTop: '1.2rem' }}>{error}</p>}
      </div>
    </div>
  );
}
