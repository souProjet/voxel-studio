import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { t } from '../i18n';

/**
 * DDP (Distributed Display Protocol) v1, as consumed by WLED on UDP 4048.
 *
 * Header (10 bytes):
 *   0  flags     0b01xx_xxxx version 1, bit0 PUSH on the last packet of a frame
 *   1  sequence  low nibble 1..15 (0 = sequence numbers unused)
 *   2  data type 0x0B = RGB, 8 bits per element (TTT=001, SSS=011)
 *   3  dest id   0x01 = default output device
 *   4  offset    u32 big-endian, byte offset into the device pixel buffer
 *   8  length    u16 big-endian, payload byte count
 */
export const DDP_HEADER_LEN = 10;
export const DDP_MAX_PAYLOAD = 1440; // 480 RGB pixels, fits a 1500-byte MTU
export const DDP_FLAG_VER1 = 0x40;
export const DDP_FLAG_PUSH = 0x01;
export const DDP_TYPE_RGB24 = 0x0b;
export const DDP_ID_DISPLAY = 0x01;

export type BridgeMode = 'native' | 'web';

export const bridgeMode: BridgeMode = isTauri() ? 'native' : 'web';

export function encodeDdpPackets(rgb: Uint8Array, sequence: number): Uint8Array[] {
  const packets: Uint8Array[] = [];
  const seq = sequence & 0x0f;
  const count = Math.max(1, Math.ceil(rgb.length / DDP_MAX_PAYLOAD));
  for (let i = 0; i < count; i++) {
    const offset = i * DDP_MAX_PAYLOAD;
    const len = Math.min(DDP_MAX_PAYLOAD, rgb.length - offset);
    const last = i === count - 1;
    const pkt = new Uint8Array(DDP_HEADER_LEN + len);
    pkt[0] = DDP_FLAG_VER1 | (last ? DDP_FLAG_PUSH : 0);
    pkt[1] = seq;
    pkt[2] = DDP_TYPE_RGB24;
    pkt[3] = DDP_ID_DISPLAY;
    pkt[4] = (offset >>> 24) & 0xff;
    pkt[5] = (offset >>> 16) & 0xff;
    pkt[6] = (offset >>> 8) & 0xff;
    pkt[7] = offset & 0xff;
    pkt[8] = (len >>> 8) & 0xff;
    pkt[9] = len & 0xff;
    pkt.set(rgb.subarray(offset, offset + len), DDP_HEADER_LEN);
    packets.push(pkt);
  }
  return packets;
}

export interface DdpSendReport {
  packets: number;
  bytes: number;
  latencyMs: number;
  native: boolean;
}

interface NativeSendReport {
  packets: number;
  bytes: number;
  micros: number;
}

/**
 * Sends one RGB frame to a device. Under Tauri the Rust side encodes and emits real UDP
 * datagrams (src-tauri/src/ddp.rs). In a browser, UDP is unavailable: the frame is encoded
 * locally and the send is simulated so the UI and inspector behave identically.
 */
export async function sendDdpFrame(ip: string, port: number, rgb: Uint8Array, sequence: number): Promise<DdpSendReport> {
  if (bridgeMode === 'native') {
    // Raw binary body: no JSON number array on the hot path.
    const report = await invoke<NativeSendReport>('send_ddp_frame', rgb, {
      headers: { 'x-ddp-ip': ip, 'x-ddp-port': String(port), 'x-ddp-seq': String(sequence & 0x0f) },
    });
    return { packets: report.packets, bytes: report.bytes, latencyMs: report.micros / 1000, native: true };
  }
  const packets = Math.max(1, Math.ceil(rgb.length / DDP_MAX_PAYLOAD));
  return {
    packets,
    bytes: rgb.length + packets * DDP_HEADER_LEN,
    latencyMs: 1.2 + Math.random() * 2.4,
    native: false,
  };
}

export function toHex(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

/* ------------------------------------------------------------------ */
/* Project files                                                       */
/* ------------------------------------------------------------------ */

export interface SavedFile {
  name: string;
  /** Display path under Tauri (never sent back to Rust), null in the browser. */
  path: string | null;
}

/**
 * Saves a project. Under Tauri the Rust side owns the file path: it reuses the file picked
 * earlier in this run (Cmd+S) or opens a native Save dialog. In the browser the file is
 * downloaded. Returns null when the user canceled.
 */
export async function saveProjectFile(contents: string, suggestedName: string, saveAs = false): Promise<SavedFile | null> {
  if (bridgeMode === 'native') {
    return invoke<SavedFile | null>('save_project', { contents, suggestedName, saveAs });
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { name: suggestedName, path: null };
}

/** Returns the chosen file, or null when the user canceled. */
export async function openProjectFile(): Promise<(SavedFile & { contents: string }) | null> {
  if (bridgeMode === 'native') {
    return invoke<(SavedFile & { contents: string }) | null>('open_project');
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(
        (contents) => resolve({ name: file.name, path: null, contents }),
        () => resolve(null),
      );
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Writes an export (CSV or JSON). Under Tauri, Rust opens the Save dialog and forces the
 * extension; in the browser the file is downloaded. Returns the file name, or null if canceled.
 */
export async function exportTextFile(contents: string, suggestedName: string, extension: 'csv' | 'json'): Promise<string | null> {
  if (bridgeMode === 'native') {
    return invoke<string | null>('export_file', { contents, suggestedName, extension });
  }
  const url = URL.createObjectURL(new Blob([contents], { type: extension === 'csv' ? 'text/csv' : 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return suggestedName;
}

/** Lets the user pick a text file to import (file input works in the browser and the Tauri webview). */
export function pickTextFile(accept: string): Promise<{ name: string; contents: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(
        (contents) => resolve({ name: file.name, contents }),
        () => resolve(null),
      );
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** New project: under Tauri, the next save asks for a file again. */
export async function forgetProjectFile(): Promise<void> {
  if (bridgeMode === 'native') await invoke('forget_project_file');
}

/** Yes/no confirmation. WKWebView does not reliably implement window.confirm, so Tauri uses the native dialog. */
export async function confirmDialog(message: string): Promise<boolean> {
  if (bridgeMode === 'native') {
    const { ask } = await import('@tauri-apps/plugin-dialog');
    return ask(message, { title: 'VOXEL // STUDIO', kind: 'warning' });
  }
  return window.confirm(message);
}

/* ------------------------------------------------------------------ */
/* Device reachability                                                 */
/* ------------------------------------------------------------------ */

export interface ProbeResult {
  reachable: boolean;
  rttMs: number;
}

const PROBE_TIMEOUT_MS = 1500;

/**
 * Checks that a WLED controller answers on its HTTP port (80).
 * Native: TCP connect from Rust. Web: an opaque no-cors request, which resolves only when
 * the host accepted the connection.
 */
export async function probeDevice(ip: string): Promise<ProbeResult> {
  if (bridgeMode === 'native') {
    const micros = await invoke<number | null>('probe_device', { ip, port: 80, timeoutMs: PROBE_TIMEOUT_MS });
    return micros === null ? { reachable: false, rttMs: 0 } : { reachable: true, rttMs: micros / 1000 };
  }
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  const t0 = performance.now();
  try {
    await fetch(`http://${ip}/`, { mode: 'no-cors', cache: 'no-store', signal: ctrl.signal });
    return { reachable: true, rttMs: performance.now() - t0 };
  } catch {
    return { reachable: false, rttMs: 0 };
  } finally {
    window.clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* Network inputs (OSC, WLED audio sync)                               */
/* ------------------------------------------------------------------ */

export interface InputsStatus {
  oscPort: number | null;
  oscError: string | null;
  wledSync: boolean;
  wledError: string | null;
  midi: boolean;
}

export interface InputsSnapshot {
  osc: [string, number][];
  midi: [string, number][];
  midiPorts: string[];
  midiError: string | null;
  wled: { fft: number[]; volume: number; peak: boolean; ageMs: number } | null;
}

/** UDP listeners and MIDI ports live in Rust; the browser build cannot open sockets. */
/**
 * Subscribes to the native output clock (`output_clock` in main.rs), which keeps ticking while the
 * window is hidden. Returns the unsubscribe function, or null in the browser, which has no native clock.
 */
export function listenOutputClock(onTick: () => void): (() => void) | null {
  if (bridgeMode !== 'native') return null;
  const off = listen('output-clock', onTick);
  return () => void off.then((unlisten) => unlisten());
}

export function configureInputs(oscPort: number | null, wledSync: boolean, midi: boolean): Promise<InputsStatus> {
  if (bridgeMode !== 'native') {
    const unavailable = t('Needs the desktop app (browsers cannot listen on UDP).');
    return Promise.resolve({
      oscPort: null,
      oscError: oscPort === null ? null : unavailable,
      wledSync: false,
      wledError: wledSync ? unavailable : null,
      midi: false,
    });
  }
  return invoke<InputsStatus>('inputs_configure', { oscPort, wledSync, midi });
}

export function pollInputs(): Promise<InputsSnapshot> {
  return invoke<InputsSnapshot>('inputs_poll');
}
