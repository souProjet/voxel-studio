//! Network inputs, received on background threads and polled by the webview.
//!
//! - OSC over UDP (any port): the first numeric argument of each message is kept per address.
//! - WLED audio sync v2: UDP multicast 239.0.0.1:11988, 44-byte packets with the header
//!   "00002" (WLED `usermods/audioreactive_v1/audio_reactive.cpp`, `struct audioSyncPacket`).
//! - MIDI from every connected port (see `midi.rs`).

use std::collections::{HashMap, HashSet};
use std::io::ErrorKind;
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::midi::MidiHub;

/// Bounds memory if something floods the port with distinct addresses.
const MAX_OSC_ADDRESSES: usize = 1024;
const MAX_BUNDLE_DEPTH: usize = 4;
pub const WLED_SYNC_PORT: u16 = 11988;
const WLED_SYNC_GROUP: Ipv4Addr = Ipv4Addr::new(239, 0, 0, 1);

/* ------------------------------------------------------------------ */
/* OSC decoding                                                        */
/* ------------------------------------------------------------------ */

fn pad4(n: usize) -> usize {
    (n + 3) & !3
}

/// Reads a NUL-terminated, 4-byte padded OSC string at `pos`. Returns it and the next offset.
fn read_str(buf: &[u8], pos: usize) -> Option<(String, usize)> {
    let rest = buf.get(pos..)?;
    let len = rest.iter().position(|&b| b == 0)?;
    let s = String::from_utf8_lossy(&rest[..len]).into_owned();
    Some((s, pos + pad4(len + 1)))
}

fn take<const N: usize>(buf: &[u8], pos: usize) -> Option<[u8; N]> {
    buf.get(pos..pos + N)?.try_into().ok()
}

/// Decodes an OSC packet (message or bundle) into (address, value) pairs.
/// A message without a numeric argument counts as 1.0 (a bare trigger).
pub fn parse_osc(buf: &[u8], out: &mut Vec<(String, f32)>) {
    parse_osc_at(buf, out, 0);
}

fn parse_osc_at(buf: &[u8], out: &mut Vec<(String, f32)>, depth: usize) {
    if buf.starts_with(b"#bundle\0") {
        if depth >= MAX_BUNDLE_DEPTH {
            return;
        }
        let mut pos = 16; // "#bundle\0" + 8-byte time tag
        while let Some(size) = take::<4>(buf, pos).map(i32::from_be_bytes) {
            let Ok(size) = usize::try_from(size) else { return };
            let Some(element) = buf.get(pos + 4..pos + 4 + size) else { return };
            parse_osc_at(element, out, depth + 1);
            pos += 4 + size;
        }
        return;
    }
    let Some((address, pos)) = read_str(buf, 0) else { return };
    if !address.starts_with('/') {
        return;
    }
    let Some((tags, mut pos)) = read_str(buf, pos) else {
        out.push((address, 1.0));
        return;
    };
    let mut value = None;
    for tag in tags.chars().skip_while(|&c| c == ',') {
        let numeric = match tag {
            'f' => Some(take::<4>(buf, pos).map(f32::from_be_bytes)),
            'i' => Some(take::<4>(buf, pos).map(|b| i32::from_be_bytes(b) as f32)),
            'd' => Some(take::<8>(buf, pos).map(|b| f64::from_be_bytes(b) as f32)),
            'h' => Some(take::<8>(buf, pos).map(|b| i64::from_be_bytes(b) as f32)),
            'T' => Some(Some(1.0)),
            'F' => Some(Some(0.0)),
            _ => None,
        };
        if let Some(v) = numeric {
            // A truncated argument means a malformed packet: drop the message.
            let Some(v) = v else { return };
            value = Some(v);
            break;
        }
        pos = match tag {
            's' | 'S' => match read_str(buf, pos) {
                Some((_, next)) => next,
                None => return,
            },
            'b' => match take::<4>(buf, pos).map(i32::from_be_bytes).and_then(|n| usize::try_from(n).ok()) {
                Some(n) => pos + 4 + pad4(n),
                None => return,
            },
            't' => pos + 8,
            'c' | 'r' | 'm' => pos + 4,
            _ => pos, // N, I, [, ] carry no data
        };
    }
    if let Some(v) = value.filter(|v| v.is_finite()) {
        out.push((address, v));
    } else if value.is_none() {
        out.push((address, 1.0));
    }
}

/* ------------------------------------------------------------------ */
/* WLED audio sync                                                     */
/* ------------------------------------------------------------------ */

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WledAudio {
    /// 16 GEQ channels, 0..255, from 43 Hz to 9.3 kHz.
    pub fft: [u8; 16],
    /// Smoothed volume (sampleSmth), roughly 0..255.
    pub volume: f32,
    pub peak: bool,
}

/// Parses a v2 audio sync packet. v1 packets ("00001", pre-0.14 firmware) are ignored.
pub fn parse_wled_sync(buf: &[u8]) -> Option<WledAudio> {
    if buf.len() < 44 || &buf[..5] != b"00002" {
        return None;
    }
    let volume = f32::from_le_bytes(take::<4>(buf, 12)?);
    let mut fft = [0u8; 16];
    fft.copy_from_slice(buf.get(18..34)?);
    Some(WledAudio { fft, volume: if volume.is_finite() { volume.max(0.0) } else { 0.0 }, peak: buf[16] > 0 })
}

/* ------------------------------------------------------------------ */
/* Listeners                                                           */
/* ------------------------------------------------------------------ */

/// Latest value per address (OSC) or key (MIDI), with the set changed since the last poll.
#[derive(Default)]
pub struct Values {
    map: HashMap<String, f32>,
    changed: HashSet<String>,
    last: Option<String>,
}

impl Values {
    pub fn record(&mut self, key: String, value: f32) {
        if self.map.len() >= MAX_OSC_ADDRESSES && !self.map.contains_key(&key) {
            return;
        }
        self.map.insert(key.clone(), value);
        self.changed.insert(key.clone());
        self.last = Some(key);
    }

    #[cfg(test)]
    pub fn get(&self, key: &str) -> Option<f32> {
        self.map.get(key).copied()
    }

    fn drain_changed(&mut self) -> Vec<(String, f32)> {
        let changed: Vec<String> = self.changed.drain().collect();
        changed.into_iter().filter_map(|k| self.map.get(&k).map(|v| (k, *v))).collect()
    }
}

struct Listener {
    port: u16,
    stop: Arc<AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Listener {
    fn spawn(socket: UdpSocket, port: u16, mut on_packet: impl FnMut(&[u8]) + Send + 'static) -> std::io::Result<Self> {
        socket.set_read_timeout(Some(Duration::from_millis(200)))?;
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let handle = thread::Builder::new().name(format!("udp-in-{port}")).spawn(move || {
            let mut buf = [0u8; 2048];
            while !flag.load(Ordering::Relaxed) {
                match socket.recv_from(&mut buf) {
                    Ok((n, _)) => on_packet(&buf[..n]),
                    Err(e) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut | ErrorKind::Interrupted) => {}
                    Err(_) => thread::sleep(Duration::from_millis(50)),
                }
            }
        })?;
        Ok(Self { port, stop, handle: Some(handle) })
    }
}

impl Drop for Listener {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

#[derive(Default)]
pub struct Inputs {
    osc: Mutex<Option<Listener>>,
    wled: Mutex<Option<Listener>>,
    midi: Mutex<Option<MidiHub>>,
    osc_values: Arc<Mutex<Values>>,
    midi_values: Arc<Mutex<Values>>,
    wled_audio: Arc<Mutex<Option<(WledAudio, Instant)>>>,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct InputsStatus {
    osc_port: Option<u16>,
    osc_error: Option<String>,
    wled_sync: bool,
    wled_error: Option<String>,
    midi: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WledSnapshot {
    fft: [u8; 16],
    volume: f32,
    peak: bool,
    age_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputsSnapshot {
    /// OSC values that changed since the previous poll.
    osc: Vec<(String, f32)>,
    /// MIDI values (cc/ch/n, note/ch/n, pb/ch) that changed since the previous poll.
    midi: Vec<(String, f32)>,
    midi_ports: Vec<String>,
    midi_error: Option<String>,
    wled: Option<WledSnapshot>,
}

pub(crate) fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    // A panicking listener thread cannot leave these maps logically inconsistent.
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl Inputs {
    /// Starts, restarts or stops the listeners to match the request. A bind failure on one
    /// input is reported in the status and does not affect the other.
    pub fn configure(&self, osc_port: Option<u16>, wled_sync: bool, midi: bool) -> InputsStatus {
        let mut status = InputsStatus::default();

        let mut osc = lock(&self.osc);
        if osc.as_ref().map(|l| l.port) != osc_port {
            *osc = None;
            if let Some(port) = osc_port {
                let sink = self.osc_values.clone();
                let started = UdpSocket::bind(("0.0.0.0", port)).and_then(|socket| {
                    let mut decoded = Vec::new();
                    Listener::spawn(socket, port, move |pkt| {
                        decoded.clear();
                        parse_osc(pkt, &mut decoded);
                        let mut values = lock(&sink);
                        for (address, value) in decoded.drain(..) {
                            values.record(address, value);
                        }
                    })
                });
                match started {
                    Ok(l) => *osc = Some(l),
                    Err(e) => status.osc_error = Some(format!("OSC port {port}: {e}")),
                }
            }
        }
        status.osc_port = osc.as_ref().map(|l| l.port);
        drop(osc);

        let mut wled = lock(&self.wled);
        if wled.is_some() != wled_sync {
            *wled = None;
            if wled_sync {
                let sink = self.wled_audio.clone();
                let started = UdpSocket::bind(("0.0.0.0", WLED_SYNC_PORT)).and_then(|socket| {
                    socket.join_multicast_v4(&WLED_SYNC_GROUP, &Ipv4Addr::UNSPECIFIED)?;
                    Listener::spawn(socket, WLED_SYNC_PORT, move |pkt| {
                        if let Some(audio) = parse_wled_sync(pkt) {
                            *lock(&sink) = Some((audio, Instant::now()));
                        }
                    })
                });
                match started {
                    Ok(l) => *wled = Some(l),
                    Err(e) => status.wled_error = Some(format!("WLED audio sync on {WLED_SYNC_PORT}: {e}")),
                }
            }
        }
        status.wled_sync = wled.is_some();
        drop(wled);

        let mut hub = lock(&self.midi);
        match (midi, hub.is_some()) {
            (true, false) => *hub = Some(MidiHub::default()),
            (false, true) => *hub = None, // dropping the hub closes every port
            _ => {}
        }
        status.midi = hub.is_some();
        status
    }

    pub fn poll(&self) -> InputsSnapshot {
        let (midi_ports, midi_error) = match lock(&self.midi).as_mut() {
            Some(hub) => {
                hub.rescan(&self.midi_values);
                (hub.ports(), hub.error.clone())
            }
            None => (Vec::new(), None),
        };
        InputsSnapshot {
            osc: lock(&self.osc_values).drain_changed(),
            midi: lock(&self.midi_values).drain_changed(),
            midi_ports,
            midi_error,
            wled: lock(&self.wled_audio).map(|(a, at)| WledSnapshot {
                fft: a.fft,
                volume: a.volume,
                peak: a.peak,
                age_ms: at.elapsed().as_millis() as u64,
            }),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn osc_msg(address: &str, tags: &str, args: &[u8]) -> Vec<u8> {
        let mut v = Vec::new();
        for s in [address, tags] {
            v.extend_from_slice(s.as_bytes());
            v.push(0);
            while v.len() % 4 != 0 {
                v.push(0);
            }
        }
        v.extend_from_slice(args);
        v
    }

    #[test]
    fn decodes_float_int_and_bool() {
        let mut out = Vec::new();
        parse_osc(&osc_msg("/voxel/fader", ",f", &0.25f32.to_be_bytes()), &mut out);
        parse_osc(&osc_msg("/a", ",i", &7i32.to_be_bytes()), &mut out);
        parse_osc(&osc_msg("/b", ",T", &[]), &mut out);
        parse_osc(&osc_msg("/c", ",sf", &[b'h', b'i', 0, 0, 0x3f, 0x80, 0, 0]), &mut out);
        assert_eq!(out, vec![("/voxel/fader".into(), 0.25), ("/a".into(), 7.0), ("/b".into(), 1.0), ("/c".into(), 1.0)]);
    }

    #[test]
    fn decodes_nested_bundles() {
        let inner = osc_msg("/x", ",f", &0.5f32.to_be_bytes());
        let mut bundle = b"#bundle\0".to_vec();
        bundle.extend_from_slice(&[0, 0, 0, 0, 0, 0, 0, 1]);
        bundle.extend_from_slice(&(inner.len() as i32).to_be_bytes());
        bundle.extend_from_slice(&inner);
        let mut out = Vec::new();
        parse_osc(&bundle, &mut out);
        assert_eq!(out, vec![("/x".into(), 0.5)]);
    }

    #[test]
    fn malformed_packets_are_ignored() {
        let mut out = Vec::new();
        for pkt in [&b""[..], b"/no-terminator", b"#bundle\0\0\0\0\0\0\0\0\0\x7f\xff\xff\xff", b"noslash\0,f\0\0\0\0\0\0"] {
            parse_osc(pkt, &mut out);
        }
        parse_osc(&osc_msg("/short", ",f", &[0x3f]), &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn parses_wled_sync_v2() {
        let mut pkt = vec![0u8; 44];
        pkt[..6].copy_from_slice(b"00002\0");
        pkt[12..16].copy_from_slice(&128.5f32.to_le_bytes());
        pkt[16] = 1;
        for i in 0..16 {
            pkt[18 + i] = (i * 10) as u8;
        }
        let a = parse_wled_sync(&pkt).unwrap();
        assert_eq!(a.volume, 128.5);
        assert!(a.peak);
        assert_eq!(a.fft[15], 150);
        pkt[4] = b'1';
        assert!(parse_wled_sync(&pkt).is_none());
        assert!(parse_wled_sync(&pkt[..20]).is_none());
    }

    #[test]
    fn osc_listener_receives_and_polls() {
        let inputs = Inputs::default();
        let probe = UdpSocket::bind("127.0.0.1:0").unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let status = inputs.configure(Some(port), false, false);
        assert_eq!(status.osc_port, Some(port));
        let tx = UdpSocket::bind("127.0.0.1:0").unwrap();
        tx.send_to(&osc_msg("/voxel/m1", ",f", &0.75f32.to_be_bytes()), ("127.0.0.1", port)).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut got = Vec::new();
        while got.is_empty() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(20));
            got = inputs.poll().osc;
        }
        assert_eq!(got, vec![("/voxel/m1".to_string(), 0.75)]);
        assert!(inputs.poll().osc.is_empty(), "values are reported once per change");
        assert_eq!(inputs.configure(None, false, false).osc_port, None);
    }
}
