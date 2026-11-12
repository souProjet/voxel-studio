// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

mod ddp;

use std::net::{IpAddr, SocketAddr};
use std::sync::Mutex;
use std::time::Instant;

use serde::Serialize;
use tauri::State;

/// Lazily bound UDP socket shared by all `send_ddp_packet` calls.
#[derive(Default)]
struct DdpState(Mutex<Option<ddp::DdpSender>>);

#[derive(Serialize)]
struct SendReport {
    packets: usize,
    bytes: usize,
    micros: u64,
}

/// Encodes `rgb` as DDP datagrams and sends them to `ip:port`.
/// Invoked from `src/services/tauriBridge.ts` at the engine's output rate.
#[tauri::command]
async fn send_ddp_packet(
    state: State<'_, DdpState>,
    ip: String,
    port: u16,
    sequence: u8,
    rgb: Vec<u8>,
) -> Result<SendReport, String> {
    let addr: IpAddr = ip.trim().parse().map_err(|e| format!("invalid IP '{ip}': {e}"))?;
    let target = SocketAddr::new(addr, port);
    let mut guard = state.0.lock().map_err(|_| "DDP socket lock poisoned".to_string())?;
    if guard.is_none() {
        *guard = Some(ddp::DdpSender::bind().map_err(|e| format!("UDP bind failed: {e}"))?);
    }
    let Some(sender) = guard.as_ref() else {
        return Err("UDP socket unavailable".to_string());
    };
    let started = Instant::now();
    let stats = sender
        .send_frame(target, &rgb, sequence)
        .map_err(|e| format!("send to {target} failed: {e}"))?;
    Ok(SendReport {
        packets: stats.packets,
        bytes: stats.bytes,
        micros: started.elapsed().as_micros() as u64,
    })
}

fn main() {
    tauri::Builder::default()
        .manage(DdpState::default())
        .invoke_handler(tauri::generate_handler![send_ddp_packet])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while running VOXEL // STUDIO: {e}");
            std::process::exit(1);
        });
}
