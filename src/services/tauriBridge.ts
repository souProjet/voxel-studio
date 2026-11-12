import { invoke, isTauri } from '@tauri-apps/api/core';

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
    const report = await invoke<NativeSendReport>('send_ddp_packet', {
      ip,
      port,
      sequence: sequence & 0x0f,
      rgb: Array.from(rgb),
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
