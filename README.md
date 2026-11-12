# VOXEL // STUDIO

Volumetric pixel mapping and real-time sensor modulation for addressable LEDs (WS2811, WS2812B, WS2815) driven by ESP32 controllers running WLED, over UDP DDP.

Place LED strips in a 3D room, run volumetric shaders across them, modulate the effects with sensors, LFOs, envelopes, MIDI or OSC, and stream the result to every controller at 40 FPS.

Desktop app built with Tauri v2 (Rust) and React. The interface is available in English and French.

## Features

- **3D studio**: lines, helices, polylines, arcs, serpentine matrices and imported point clouds; draggable handles, camera presets, undo/redo.
- **Wiring**: data direction, skipped LEDs, per-segment gain, wire color order, output order per controller.
- **Effects**: four volumetric shaders, color palettes, crossfades, tap tempo and tempo-synced speed.
- **Modulation**: a patch graph from sources to effect parameters with curves, input range, smoothing and amount modulation. Spatial targets react around a sensor's position in the room.
- **Sources**: simulated sensors, the computer microphone, WLED audio sync (multicast 239.0.0.1:11988), OSC (UDP 9000), MIDI from any connected port with learn, plus LFO, ADSR envelope and macro generators.
- **Fleet**: per-controller test patterns, reachability probes, send error reporting, power estimate with a WLED-style current limiter, live DDP packet inspector.
- **Show safety**: blackout that keeps streaming, panic, autosave with crash recovery, output that keeps running while the window is hidden.
- **Mapping I/O**: import LED positions from CSV, export the per-LED mapping as CSV or JSON.
- **Up to 16,384 LEDs** per project.

## Getting started

Requirements: Node.js 22+, and Rust (stable) for the desktop app.

```bash
npm install
npm run tauri dev   # desktop app with real UDP output
npm run dev         # browser preview at http://localhost:1420 (UDP is simulated)
```

Build a release bundle:

```bash
npm run tauri build
```

## Development

```bash
npm run check                 # typecheck, ESLint, Prettier, Vitest
cd src-tauri && cargo test    # Rust tests (add -- --ignored for the CoreMIDI loopback test)
```

| Path             | Contents                                                                    |
| ---------------- | --------------------------------------------------------------------------- |
| `src/components` | React views: studio, scanner, modulation, fleet, live pad                   |
| `src/services`   | Engine, geometry, shaders, sensors, generators, project files, Tauri bridge |
| `src/state`      | External store with undo history                                            |
| `src/i18n`       | Translation layer and French dictionaries                                   |
| `src-tauri/src`  | DDP sender, OSC/WLED/MIDI inputs, native file dialogs                       |

## Protocols

- **DDP** v1 to WLED on UDP 4048, RGB 8-bit, 480 pixels per datagram, PUSH on the last packet.
- **OSC** sensor channels at `/voxel/<sensor id>/<channel id>`; OSC generators listen on any address.
- **MIDI** keys: `cc/<channel>/<number>`, `note/<channel>/<note>`, `pb/<channel>`.

Output and probes are limited to local network addresses.

## License

[MIT](LICENSE)
