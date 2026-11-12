//! MIDI input from every connected port (USB controllers, IAC bus, network sessions).
//!
//! WKWebView has no Web MIDI, so ports are opened here with `midir` (CoreMIDI on macOS).
//! Messages become normalized values keyed like OSC addresses:
//! `cc/<channel>/<controller>`, `note/<channel>/<note>` (velocity, 0 on release) and
//! `pb/<channel>` (pitch bend). Channels are 1-based, as printed on controllers.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use midir::{Ignore, MidiInput, MidiInputConnection};

use crate::inputs::Values;

const CLIENT_NAME: &str = "VOXEL STUDIO";
/// Hot-plug: how often the port list is compared with the open connections.
const RESCAN_EVERY: Duration = Duration::from_secs(2);

/// Decodes one channel message into a (key, value 0..1) pair. System and running-status
/// fragments are ignored.
pub fn decode(msg: &[u8]) -> Option<(String, f32)> {
    let (&status, data) = msg.split_first()?;
    let ch = (status & 0x0F) + 1;
    let d0 = *data.first()?;
    match status & 0xF0 {
        0xB0 => Some((format!("cc/{ch}/{d0}"), f32::from(*data.get(1)? & 0x7F) / 127.0)),
        0x90 => Some((format!("note/{ch}/{d0}"), f32::from(*data.get(1)? & 0x7F) / 127.0)),
        0x80 => Some((format!("note/{ch}/{d0}"), 0.0)),
        0xE0 => {
            let v = u16::from(d0 & 0x7F) | (u16::from(*data.get(1)? & 0x7F) << 7);
            Some((format!("pb/{ch}"), f32::from(v) / 16383.0))
        }
        _ => None,
    }
}

#[derive(Default)]
pub struct MidiHub {
    connections: HashMap<String, MidiInputConnection<()>>,
    last_scan: Option<Instant>,
    pub error: Option<String>,
}

impl MidiHub {
    pub fn ports(&self) -> Vec<String> {
        let mut names: Vec<String> = self.connections.keys().cloned().collect();
        names.sort();
        names
    }

    /// Opens newly plugged ports and drops unplugged ones, at most every RESCAN_EVERY.
    pub fn rescan(&mut self, values: &Arc<Mutex<Values>>) {
        if self.last_scan.is_some_and(|t| t.elapsed() < RESCAN_EVERY) {
            return;
        }
        self.last_scan = Some(Instant::now());
        let lister = match MidiInput::new(CLIENT_NAME) {
            Ok(m) => m,
            Err(e) => {
                self.error = Some(format!("MIDI unavailable: {e}"));
                return;
            }
        };
        self.error = None;
        let available: Vec<(String, midir::MidiInputPort)> = lister
            .ports()
            .into_iter()
            .filter_map(|p| lister.port_name(&p).ok().map(|n| (n, p)))
            .collect();
        self.connections.retain(|name, _| available.iter().any(|(n, _)| n == name));
        for (name, port) in available {
            if self.connections.contains_key(&name) {
                continue;
            }
            // `connect` consumes the MidiInput, so each port gets its own client.
            let Ok(mut input) = MidiInput::new(CLIENT_NAME) else { continue };
            input.ignore(Ignore::All);
            let sink = values.clone();
            match input.connect(
                &port,
                "voxel-studio-in",
                move |_, msg, _| {
                    if let Some((key, v)) = decode(msg) {
                        crate::inputs::lock(&sink).record(key, v);
                    }
                },
                (),
            ) {
                Ok(conn) => {
                    self.connections.insert(name, conn);
                }
                Err(e) => self.error = Some(format!("MIDI port {name}: {e}")),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::decode;

    #[test]
    fn decodes_channel_messages() {
        assert_eq!(decode(&[0xB0, 74, 127]), Some(("cc/1/74".into(), 1.0)));
        assert_eq!(decode(&[0x9F, 60, 0]), Some(("note/16/60".into(), 0.0)));
        assert_eq!(decode(&[0x82, 60, 99]), Some(("note/3/60".into(), 0.0)));
        assert_eq!(decode(&[0xE0, 0x7F, 0x7F]), Some(("pb/1".into(), 1.0)));
        assert_eq!(decode(&[0xF8]), None);
        assert_eq!(decode(&[0xB0, 74]), None);
        assert_eq!(decode(&[]), None);
    }

    /// End to end through CoreMIDI with a virtual port. Ignored by default because it
    /// publishes a port on the system MIDI server: `cargo test -- --ignored`.
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore]
    fn receives_from_a_virtual_port() {
        use super::MidiHub;
        use crate::inputs::Values;
        use midir::os::unix::VirtualOutput;
        use std::sync::{Arc, Mutex};
        use std::time::{Duration, Instant};

        let mut out = midir::MidiOutput::new("voxel-test").unwrap().create_virtual("voxel-test-port").unwrap();
        let values = Arc::new(Mutex::new(Values::default()));
        let mut hub = MidiHub::default();
        hub.rescan(&values);
        assert!(hub.ports().iter().any(|p| p.contains("voxel-test-port")), "ports: {:?}", hub.ports());
        let deadline = Instant::now() + Duration::from_secs(2);
        let mut got = None;
        while got.is_none() && Instant::now() < deadline {
            out.send(&[0xB0, 74, 127]).unwrap();
            std::thread::sleep(Duration::from_millis(50));
            got = values.lock().unwrap().get("cc/1/74");
        }
        assert_eq!(got, Some(1.0));
    }
}
