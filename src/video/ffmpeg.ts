import { spawn } from 'node:child_process';

/**
 * Cesty k binarkam jdou prepsat promennymi prostredi, aby aplikace fungovala
 * i tam, kde ffmpeg neni v PATH (typicky zabalena desktopova verze).
 */
export const FFMPEG = process.env['FFMPEG_PATH'] ?? 'ffmpeg';
export const FFPROBE = process.env['FFPROBE_PATH'] ?? 'ffprobe';

export interface InfoVidea {
  sirka: number;
  vyska: number;
  fps: number;
  delka: number;
}

function spustAVrat(prikaz: string, argumenty: string[]): Promise<string> {
  return new Promise((splnit, odmitnout) => {
    const proces = spawn(prikaz, argumenty, { windowsHide: true });
    let vystup = '';
    let chyby = '';
    proces.stdout.on('data', (d: Buffer) => (vystup += d.toString()));
    proces.stderr.on('data', (d: Buffer) => (chyby += d.toString()));
    proces.on('error', (e) =>
      odmitnout(new Error(`Nepodarilo se spustit ${prikaz}: ${e.message}`)),
    );
    proces.on('close', (kod) => {
      if (kod === 0) splnit(vystup);
      else odmitnout(new Error(`${prikaz} skoncil s kodem ${kod}\n${chyby.slice(-2000)}`));
    });
  });
}

function zlomekNaCislo(text: string): number {
  const [citatel, jmenovatel] = text.split('/');
  const c = Number(citatel);
  const j = Number(jmenovatel ?? 1);
  return j === 0 ? 0 : c / j;
}

export async function nactiInfo(video: string): Promise<InfoVidea> {
  const json = await spustAVrat(FFPROBE, [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate,avg_frame_rate',
    '-show_entries', 'format=duration',
    '-of', 'json',
    video,
  ]);
  const data = JSON.parse(json) as {
    streams?: { width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string }[];
    format?: { duration?: string };
  };
  const stream = data.streams?.[0];
  if (!stream?.width || !stream.height) {
    throw new Error(`Ve videu ${video} nebyla nalezena obrazova stopa.`);
  }
  const fps =
    zlomekNaCislo(stream.avg_frame_rate ?? '0/1') || zlomekNaCislo(stream.r_frame_rate ?? '25/1');
  return {
    sirka: stream.width,
    vyska: stream.height,
    fps: fps || 25,
    delka: Number(data.format?.duration ?? 0),
  };
}

/** Spusti ffmpeg a preda syrove rgb24 snimky pevne velikosti po jednom. */
export function ctiSyroveSnimky(
  argumenty: string[],
  bajtuNaSnimek: number,
  naSnimek: (data: Uint8Array, index: number) => void,
): Promise<number> {
  return new Promise((splnit, odmitnout) => {
    const proces = spawn(FFMPEG, argumenty, { windowsHide: true });
    let zbytek: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let index = 0;
    let chyby = '';

    proces.stdout.on('data', (kus: Buffer) => {
      zbytek = zbytek.length === 0 ? kus : Buffer.concat([zbytek, kus]);
      while (zbytek.length >= bajtuNaSnimek) {
        naSnimek(
          new Uint8Array(zbytek.buffer, zbytek.byteOffset, bajtuNaSnimek),
          index++,
        );
        zbytek = zbytek.subarray(bajtuNaSnimek);
      }
    });
    proces.stderr.on('data', (d: Buffer) => {
      chyby += d.toString();
      if (chyby.length > 8000) chyby = chyby.slice(-4000);
    });
    proces.on('error', (e) => odmitnout(new Error(`Nepodarilo se spustit ffmpeg: ${e.message}`)));
    proces.on('close', (kod) => {
      if (kod === 0) splnit(index);
      else odmitnout(new Error(`ffmpeg skoncil s kodem ${kod}\n${chyby.slice(-2000)}`));
    });
  });
}
