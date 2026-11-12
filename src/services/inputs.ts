import { bridgeMode, configureInputs, pollInputs, type InputsSnapshot, type InputsStatus } from './tauriBridge';

/** OSC listen port. 9000 is a common send port in TouchOSC and Open Stage Control templates. */
export const OSC_PORT = 9000;

/** Latest network and MIDI input state, written by the sensor tick and read by sources and generators. */
export const inputs = {
  osc: new Map<string, number>(),
  midi: new Map<string, number>(),
  midiPorts: [] as string[],
  midiError: null as string | null,
  wled: null as InputsSnapshot['wled'],
  status: { oscPort: null, oscError: null, wledSync: false, wledError: null, midi: false } as InputsStatus,
};

export type InputKind = 'osc' | 'midi';

let applied: string | null = null;
let configuring = false;
let polling = false;
let learner: { kind: InputKind; done: (key: string) => void } | null = null;

/** The next OSC address or MIDI control received goes to `onKey`. Returns a cancel function. */
export function learnInput(kind: InputKind, onKey: (key: string) => void): () => void {
  const entry = { kind, done: onKey };
  learner = entry;
  return () => {
    if (learner === entry) learner = null;
  };
}

/**
 * Called at the sensor tick: opens or closes the UDP listeners to match what the project
 * uses, then fetches new values (one request in flight at a time).
 */
export function syncInputs(wantOsc: boolean, wantWled: boolean, wantMidi: boolean): void {
  const oscPort = wantOsc ? OSC_PORT : null;
  const key = `${oscPort}:${wantWled}:${wantMidi}`;
  if (key !== applied && !configuring) {
    configuring = true;
    configureInputs(oscPort, wantWled, wantMidi)
      .then((status) => {
        inputs.status = status;
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        inputs.status = { oscPort: null, oscError: wantOsc ? msg : null, wledSync: false, wledError: wantWled ? msg : null, midi: false };
        inputs.midiError = wantMidi ? msg : null;
      })
      .finally(() => {
        applied = key;
        configuring = false;
      });
  }
  if (!wantWled) inputs.wled = null;
  if (!wantMidi) inputs.midiPorts = [];
  if (bridgeMode !== 'native' || polling || (!wantOsc && !wantWled && !wantMidi)) return;
  polling = true;
  pollInputs()
    .then((snap) => {
      for (const [address, value] of snap.osc) inputs.osc.set(address, value);
      for (const [k, value] of snap.midi) inputs.midi.set(k, value);
      inputs.midiPorts = snap.midiPorts;
      inputs.midiError = snap.midiError;
      inputs.wled = snap.wled;
      if (learner) {
        // MIDI learn prefers moving controls: a note release (0) right after a press is skipped.
        const pool = learner.kind === 'osc' ? snap.osc : snap.midi.filter(([, v]) => v > 0);
        const last = pool.at(-1);
        if (last) {
          const { done } = learner;
          learner = null;
          done(last[0]);
        }
      }
    })
    .catch(() => undefined)
    .finally(() => {
      polling = false;
    });
}
