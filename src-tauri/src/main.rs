// Prevents an extra console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![cfg_attr(test, allow(clippy::unwrap_used, clippy::expect_used))]

mod ddp;

use std::net::{IpAddr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;

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

/// Path of the project file the user picked in a native dialog during this run.
/// The webview never sends a path: it can only save to or open a file the user chose,
/// so a compromised page cannot read or overwrite arbitrary files.
#[derive(Default)]
struct ProjectFile(Mutex<Option<PathBuf>>);

#[derive(Serialize)]
struct FileRef {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct OpenedFile {
    name: String,
    path: String,
    contents: String,
}

const PROJECT_FILTER: &str = "VOXEL // STUDIO project";

/// Forces a `.json` extension so the dialog cannot be used to write other file types.
fn with_json_extension(mut path: PathBuf) -> PathBuf {
    let is_json = path
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("json"));
    if !is_json {
        path.set_extension("voxel.json");
    }
    path
}

fn file_ref(path: &Path) -> FileRef {
    FileRef {
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        path: path.display().to_string(),
    }
}

/// Saves to the file chosen earlier in this run, or asks with a native Save dialog when
/// there is none or `save_as` is set. Returns None when the user cancels.
#[tauri::command]
async fn save_project(
    app: AppHandle,
    state: State<'_, ProjectFile>,
    contents: String,
    suggested_name: String,
    save_as: bool,
) -> Result<Option<FileRef>, String> {
    let current = state.0.lock().map_err(|_| "project lock poisoned".to_string())?.clone();
    let path = match current {
        Some(p) if !save_as => p,
        _ => {
            let Some(picked) = app
                .dialog()
                .file()
                .add_filter(PROJECT_FILTER, &["json"])
                .set_file_name(suggested_name)
                .blocking_save_file()
            else {
                return Ok(None);
            };
            with_json_extension(picked.into_path().map_err(|e| e.to_string())?)
        }
    };
    std::fs::write(&path, contents).map_err(|e| format!("cannot write {}: {e}", path.display()))?;
    let reference = file_ref(&path);
    *state.0.lock().map_err(|_| "project lock poisoned".to_string())? = Some(path);
    Ok(Some(reference))
}

/// Native Open dialog restricted to JSON files. Returns None when the user cancels.
#[tauri::command]
async fn open_project(app: AppHandle, state: State<'_, ProjectFile>) -> Result<Option<OpenedFile>, String> {
    let Some(picked) = app
        .dialog()
        .file()
        .add_filter(PROJECT_FILTER, &["json"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = picked.into_path().map_err(|e| e.to_string())?;
    if with_json_extension(path.clone()) != path {
        return Err(format!("{} is not a .json project file", path.display()));
    }
    let contents = std::fs::read_to_string(&path).map_err(|e| format!("cannot read {}: {e}", path.display()))?;
    let FileRef { name, path: shown } = file_ref(&path);
    *state.0.lock().map_err(|_| "project lock poisoned".to_string())? = Some(path);
    Ok(Some(OpenedFile { name, path: shown, contents }))
}

/// New project: the next save must ask for a file again.
#[tauri::command]
fn forget_project_file(state: State<'_, ProjectFile>) -> Result<(), String> {
    *state.0.lock().map_err(|_| "project lock poisoned".to_string())? = None;
    Ok(())
}

/// TCP connect probe (WLED serves HTTP on port 80). Returns the connect time in
/// microseconds, or None when the host did not accept the connection in time.
#[tauri::command]
async fn probe_device(ip: String, port: u16, timeout_ms: u64) -> Result<Option<u64>, String> {
    let addr: IpAddr = ip.trim().parse().map_err(|e| format!("invalid IP '{ip}': {e}"))?;
    let target = SocketAddr::new(addr, port);
    let timeout = Duration::from_millis(timeout_ms.clamp(50, 5000));
    tauri::async_runtime::spawn_blocking(move || {
        let started = Instant::now();
        TcpStream::connect_timeout(&target, timeout)
            .ok()
            .map(|_| started.elapsed().as_micros() as u64)
    })
    .await
    .map_err(|e| format!("probe task failed: {e}"))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DdpState::default())
        .manage(ProjectFile::default())
        .invoke_handler(tauri::generate_handler![
            send_ddp_packet,
            save_project,
            open_project,
            forget_project_file,
            probe_device
        ])
        .run(tauri::generate_context!())
        .unwrap_or_else(|e| {
            eprintln!("error while running VOXEL // STUDIO: {e}");
            std::process::exit(1);
        });
}

#[cfg(test)]
mod tests {
    use super::with_json_extension;
    use std::path::PathBuf;

    #[test]
    fn saved_projects_always_end_in_json() {
        assert_eq!(with_json_extension(PathBuf::from("/tmp/show.voxel.json")), PathBuf::from("/tmp/show.voxel.json"));
        assert_eq!(with_json_extension(PathBuf::from("/tmp/SHOW.JSON")), PathBuf::from("/tmp/SHOW.JSON"));
        assert_eq!(with_json_extension(PathBuf::from("/tmp/show")), PathBuf::from("/tmp/show.voxel.json"));
        assert_eq!(with_json_extension(PathBuf::from("/tmp/run.sh")), PathBuf::from("/tmp/run.voxel.json"));
    }
}
