# Playing from the score

The second half of the app: once a video is transcribed — or any MusicXML,
MXL, MEI, ABC or MIDI file is opened — the score fills the window and the app
follows the player. It listens through a microphone or a MIDI keyboard, turns
each note green when it is heard and red when it is passed by, and turns the
lines of music without a hand.

## What it does

| | |
|---|---|
| **Listening** | Microphone at the piano, or a digital piano over USB/Bluetooth MIDI. A microphone check (play C–E–G) shows what is heard. |
| **Following** | Wait mode: the cursor waits for the step due; moving on marks what was left out. Skips and repeats are followed, a lost place is found again. |
| **Colours** | Green played, red missed, amber due now, grey the other hand, muted green for a chord note a microphone heard only as part of the chord. |
| **Turning** | *Lines* (each line keeps its slot, the finished one gives way to the next), *pages* (turned half-way through the last line, which stays on top) or *smooth scroll*. Page-turn pedals work as they are. |
| **Practising** | One hand alone, with the other hand played by the app. A–B loop snapped to measures with a count of clean passes. Click a note to start there. |
| **Listening to it** | The score played with a moving cursor at 50, 75 or 100 %. |
| **Results** | Accuracy with medal tiers, comparison with earlier runs, and the measures that keep going wrong — each one a click away from a loop. |
| **Comfort** | Night paper, zoom, full screen, keyboard shortcuts, the screen kept awake, recent files, a demo piece. |

Shortcuts: arrows / PgUp / PgDn / Space turn, `P` plays the demonstration,
`L` toggles the loop, `R` restarts, `H` cycles the hands, `+`/`−` zoom, `F`
full screen, `?` lists them. Shift-click a note to stretch the loop to it.

## How the listening works

Blind polyphonic transcription is exactly what the rest of this project
avoids, and the practice screen avoids it too: the score says what comes
next, so the listener only decides, strike by strike, whether the few notes
it expects just began (`src/core/listen.ts`).

1. **Strikes.** An onset function after SuperFlux (Böck & Widmer, DAFx 2013):
   the rise of the log spectrum against the maximum of neighbouring bins two
   frames back. Window 85 ms, hop 10.7 ms at 48 kHz.
2. **Rises, not levels.** For every strike the spectrum some 65–85 ms after it
   is compared peak to peak with the one before it. Notes still ringing —
   held, pedalled — have a falling envelope and drop out; the unison strings
   of a piano beat, and comparing peaks keeps a partial swelling out of a beat
   trough from looking like a new strike. A rise must also last to the last
   frame, which removes claps, knocks and the thump of the hammer.
3. **Stretched partials.** Piano strings are stiff, so the partials are not
   multiples of the fundamental: `f_n = n f0 √(1 + B n²)`, with B along the
   keyboard after Rigaud, David & Daudet (2013). Only peaks of the spectrum
   count; the skirts of a loud partial are leakage.
4. **Octaves.** A note counts when its partials rise *and the gaps between
   them do not* — the octave below rises in between — *and its odd partials
   rise too* — the octave above feeds only the even ones.
5. **Explaining away.** Candidates are accepted strongest first, and partials
   of accepted notes are left out when judging the rest. Without it, every
   note sharing partials with a struck chord (its fifth, third, octave) would
   be heard as well.
6. **Prior.** Notes due now need less evidence than notes further ahead; a
   wrong note is looked for only among the neighbours of an expected note
   that was not heard.

The same score-informed idea runs through the literature on piano tutoring
from audio — Cheng, Hu & Saul's *Sight Reading Tutor* (ICASSP 2008), Benetos,
Klapuri & Dixon's score-informed transcription for tutoring (EUSIPCO 2012),
Dessein & Cont's real-time non-negative decomposition — though they learn
note templates; here the template is a physical model, so nothing has to be
recorded on the user's piano first. Spotify's Basic Pitch was considered and
rejected for this: it works on fixed two-second windows and is not meant for
low-latency streaming.

The browser's speech processing — echo cancellation, noise suppression,
automatic gain — would destroy exactly the rises the listener looks for, so
all three are switched off, and samples come straight off the audio thread
through an AudioWorklet (`app/src/practice/microphone.ts`).

## How the following works

`src/core/follow.ts`, in the tradition of Synthesia's and PianoBooster's wait
modes, with what reading from paper adds:

- A chord from MIDI is complete with all its notes; from a microphone most of
  it (60 %) is enough, and its late notes still land in it for a moment.
- Playing the next step moves on at once; a jump further ahead needs a second
  confirming note. One microphone strike moves the finger by one step at most,
  so the chord's own echo is never taken for the next step.
- Strikes that fit nowhere make the follower look further ahead and, after
  three, search a few lines around for where the last strikes fit in order —
  forward first, back by about a line for a repeated phrase.

## Measured

`scripts/listen-bench.mjs` mixes real piano recordings (the npm packages
`tonejs-instrument-piano-mp3` and `piano-mp3`) into a deliberately hard
performance: 300 random chords of one to four notes over four octaves,
0.12–0.72 s apart, half under the pedal, with slipped keys, octave slips and
dropped chord notes, room reverb and hiss. Two seeds per set:

| | recordings A | recordings B |
|---|---|---|
| notes played and recognised | 85–89 % | 80–82 % |
| false notes per strike | 0.14–0.24 | 0.23–0.26 |
| neighbour-key slips reported as wrong | 9/17, 14/24 | 9/17, 15/24 |
| octave slips taken for the note | 3/12, 6/14 | 2/13, 2/14 |
| latency, median | 150 ms | 128 ms |
| **with the follower:** played notes not marked red | 89–91 % | 82–83 % |
| place kept within one step | 93–96 % | 90–91 % |
| reached the end | 300/300 | 300/300 |

Real music is kinder than this: steadier tempo, fewer wide chords. An
end-to-end run in Chromium with a fake microphone playing a rendered Ode to
Joy (`Óda na radost`, the demo piece) finished at 96 %: 109 of 126 notes
green, 11 chord notes left unsure and 5 marked missed — one of them skipped
on purpose in the recording.

Weak spots, honestly: the lowest octave (thin fundamentals, partials crowded
together), octave doublings within one chord, and very soft notes under a
loud held chord. MIDI has none of them.

## What other tools do, and what was taken

Synthesia, flowkey, Piano Marvel, Simply Piano, Skoove, Yousician, Tomplay,
MuseScore, forScore, Newzik, PianoBooster and others were surveyed. Taken:
wait mode with hand separation (Synthesia, flowkey), the other hand played
by the app (PianoBooster), A–B loops with clean-pass counting (Piano Marvel,
Soundslice), 50/75/100 % presets (flowkey), medal tiers (Piano Marvel), the
half-page turn (forScore, MobileSheets) taken further into rolling lines, and
pedal keys as AirTurn and PageFlip send them. For the per-measure record of
mistakes the survey found no counterpart in the mainstream apps.

Not done yet, and the natural next steps: a tempo mode that grades rhythm as
well as pitch, with a metronome and count-in; a speed trainer that raises the
tempo after clean loop passes; annotations anchored to measures.

## Platform notes

Electron grants the microphone and MIDI permissions by default. On macOS the
app asks for the microphone once through `systemPreferences`; a packaged
build needs `NSMicrophoneUsageDescription` in its Info.plist (and the
`com.apple.security.device.audio-input` entitlement under the hardened
runtime).
