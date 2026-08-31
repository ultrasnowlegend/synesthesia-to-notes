import { useState } from 'react';

interface Vlastnosti {
  chyba: string;
  naVideo: (cesta: string) => void;
}

export function Uvod({ chyba, naVideo }: Vlastnosti): React.JSX.Element {
  const [nadZonou, setNadZonou] = useState(false);

  const vyber = async (): Promise<void> => {
    const odpoved = await window.aplikace.vyberVideo();
    if (odpoved.ok && odpoved.data) naVideo(odpoved.data);
  };

  return (
    <div className="uvod">
      <div className="uvod-karta">
        <h1>Z videa zpět do not</h1>
        <p>
          Nahrávka klavíru s padajícími pruhy v sobě noty už obsahuje — jen v obraze místo
          v zápisu. Přetáhni video sem a nech si ho přepsat.
        </p>
        <div
          className={`zona${nadZonou ? ' aktivni' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setNadZonou(true);
          }}
          onDragLeave={() => setNadZonou(false)}
          onDrop={(e) => {
            e.preventDefault();
            setNadZonou(false);
            const soubor = e.dataTransfer.files[0];
            if (soubor) naVideo(window.aplikace.cestaSouboru(soubor));
          }}
        >
          <p style={{ marginBottom: '1.2rem' }}>Přetáhni sem soubor s videem</p>
          <button className="hlavni" onClick={() => void vyber()}>
            Vybrat video…
          </button>
        </div>
        {chyba && <p className="chyba" style={{ marginTop: '1.2rem' }}>{chyba}</p>}
      </div>
    </div>
  );
}
