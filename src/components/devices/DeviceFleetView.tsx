import { useEffect, useMemo, useState } from 'react';
import { Binary, Cpu, Pause, Play, Plug, Plus, Power, Radar, Satellite, Trash, Wifi } from 'lucide-react';
import type { ESP32Device, TestPattern } from '../../types/voxel';
import { useVoxel, useVoxelActions, uid } from '../../state/useVoxelStore';
import { useDeleteCommands } from '../../state/useDeleteCommands';
import { CHIPSETS, DDP_PORT, KIND_META, LIMITER_RATIO } from '../../services/catalog';
import { denormalize, sensorChannels } from '../../services/sensors';
import { runtime, type DeviceFrame } from '../../services/engine';
import { bridgeMode, DDP_HEADER_LEN, toHex } from '../../services/tauriBridge';
import { ScrubInput } from '../ui/ScrubInput';
import { Card, SectionHeader, Segmented, TextInput, Toggle } from '../ui/primitives';
import { t, tk } from '../../i18n';

function RssiBars({ rssi }: { rssi: number }) {
  const level = Number.isNaN(rssi) ? 0 : rssi > -55 ? 4 : rssi > -65 ? 3 : rssi > -75 ? 2 : 1;
  return (
    <div className="flex h-3 items-end gap-[2px]">
      {[1, 2, 3, 4].map((b) => (
        <span key={b} className={`w-[3px] rounded-[1px] ${b <= level ? 'bg-net' : 'bg-line'}`} style={{ height: `${b * 25}%` }} />
      ))}
    </div>
  );
}

function Metric({ label, value, unit, color = 'text-zinc-200' }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="rounded-[5px] border border-line bg-inset px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`tabular font-mono text-[12px] ${color}`}>
        {value}
        {unit && <span className="ml-0.5 text-[10px] text-zinc-500">{unit}</span>}
      </div>
    </div>
  );
}

const TEST_PATTERNS: { value: TestPattern; label: string }[] = [
  { value: 'off', label: tk('Off') },
  { value: 'identify', label: 'ID' },
  { value: 'white', label: 'W' },
  { value: 'red', label: 'R' },
  { value: 'green', label: 'G' },
  { value: 'blue', label: 'B' },
  { value: 'chase', label: tk('Chase') },
];

function DeviceCard({ device }: { device: ESP32Device }) {
  const pattern = useVoxel((s) => s.testPatterns[device.id] ?? 'off');
  const strips = useVoxel((s) => s.strips);
  const stats = useVoxel((s) => s.stats.devices[device.id]);
  const health = useVoxel((s) => s.health[device.id]);
  const allSensors = useVoxel((s) => s.sensors);
  const values = useVoxel((s) => s.sensorValues);
  const hosted = useMemo(() => allSensors.filter((x) => x.deviceId === device.id), [allSensors, device.id]);
  const gpsSensor = hosted.find((x) => x.kind === 'gps');
  const gpsChannel = gpsSensor ? sensorChannels(gpsSensor)[0] : null;
  const gps = gpsChannel ? denormalize(gpsChannel, values[gpsChannel.key] ?? 0) : 0;
  const { updateDevice, setTestPattern } = useVoxelActions();
  const del = useDeleteCommands();
  const remove = () => del.device(device.id);
  const set = (patch: Partial<ESP32Device>) => updateDevice(device.id, patch);
  const outputs = useMemo(() => strips.filter((s) => s.deviceId === device.id), [strips, device.id]);
  const isDdp = device.protocol === 'DDP';
  const amps = stats?.amps ?? 0;
  const loadPct = Math.min(1, amps / device.psuMaxAmps);
  const fullWhiteAmps = outputs.reduce((a, s) => a + (s.ledCount * CHIPSETS[s.chipset].maFullWhite * CHIPSETS[s.chipset].voltage) / 1000 / device.psuVoltage, 0);

  return (
    <Card className="flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2">
        <span
          title={
            device.firmware !== 'WLED'
              ? t('Not probed (custom firmware)')
              : !health
                ? t('Probing…')
                : health.reachable
                  ? t('Answers on HTTP :80 in {ms} ms', { ms: health.rttMs.toFixed(0) })
                  : t('No answer on HTTP :80')
          }
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            health?.reachable ? 'bg-net shadow-[0_0_6px_#10b981]' : health?.reachable === false ? 'bg-red-500 shadow-[0_0_6px_#ef4444]' : 'bg-zinc-600'
          }`}
        />
        <div className="min-w-0">
          <input
            value={device.name}
            onChange={(e) => set({ name: e.target.value })}
            spellCheck={false}
            className="w-full truncate bg-transparent text-[12px] font-medium text-zinc-100 outline-none focus:text-white"
          />
          <div className="font-mono text-[10px] text-zinc-500">
            {device.chip} · {device.firmware} ·{' '}
            {device.firmware !== 'WLED' ? (
              <span>{t('not probed')}</span>
            ) : !health ? (
              <span>{t('probing…')}</span>
            ) : health.reachable ? (
              <span className="text-net">{t('reachable {ms} ms', { ms: health.rttMs.toFixed(0) })}</span>
            ) : (
              <span className="text-red-400">{t('unreachable')}</span>
            )}
          </div>
        </div>
        <span className={`ml-auto rounded-[4px] border px-1.5 py-0.5 font-mono text-[9px] ${isDdp ? 'border-net/40 text-net' : 'border-gps/40 text-gps'}`}>
          {device.protocol}:{device.port}
        </span>
        <button
          type="button"
          title={device.online ? t('Output enabled: click to stop streaming to this device') : t('Output disabled: click to stream to this device')}
          onClick={() => set({ online: !device.online })}
          className={`flex h-6 w-6 items-center justify-center rounded-[5px] border ${device.online ? 'border-net/40 text-net' : 'border-line text-zinc-600'}`}
        >
          <Power size={12} />
        </button>
        <button
          type="button"
          title={t('Remove device')}
          onClick={remove}
          className="flex h-6 w-6 items-center justify-center rounded-[5px] border border-line text-zinc-500 hover:border-red-500/50 hover:text-red-400"
        >
          <Trash size={12} />
        </button>
      </div>

      <div className="flex flex-col gap-2 p-3">
        <div className="grid grid-cols-[1fr_84px] gap-1.5">
          <TextInput mono value={device.ip} onChange={(ip) => set({ ip: ip.trim() })} />
          <ScrubInput value={device.port} onChange={(port) => set({ port })} min={1} max={65535} step={1} label="P" accent="#10B981" />
        </div>
        <div className="flex items-center justify-between font-mono text-[10px] text-zinc-500">
          <span>MAC {device.mac}</span>
          <span className="flex items-center gap-1.5">
            <RssiBars rssi={stats?.rssi ?? Number.NaN} />
            {stats && !Number.isNaN(stats.rssi) ? `${stats.rssi} dBm` : '-- dBm'}
          </span>
        </div>

        {(stats?.errors ?? 0) > 0 && (
          <div className="rounded-[5px] border border-red-500/40 bg-red-500/10 px-2 py-1.5 font-mono text-[10px] text-red-300">
            {stats?.errors === 1
              ? t('1 send error · {error}', { error: stats.lastError ?? '' })
              : t('{n} send errors · {error}', { n: stats?.errors ?? 0, error: stats?.lastError ?? '' })}
          </div>
        )}
        {isDdp ? (
          <div className="grid grid-cols-3 gap-1.5">
            <Metric label={t('Out FPS')} value={(stats?.fps ?? 0).toFixed(0)} color="text-net" />
            <Metric label={t('Send')} value={(stats?.latencyMs ?? 0).toFixed(2)} unit="ms" />
            <Metric label={t('Pkt/frame')} value={String(stats?.packetsPerFrame ?? 0)} />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            <Metric label={t('GPS speed')} value={gps.toFixed(1)} unit="km/h" color="text-gps" />
            <Metric label={t('OSC addr')} value="/voxel/gps" color="text-zinc-300" />
          </div>
        )}

        <div className="flex flex-wrap gap-1">
          {hosted.length === 0 && <span className="text-[10px] text-zinc-600">{t('No sensors hosted.')}</span>}
          {hosted.map((s) => (
            <span key={s.id} className="flex items-center gap-1 rounded-[4px] border border-line bg-inset px-1.5 py-0.5 text-[10px] text-zinc-400">
              <Satellite size={10} style={{ color: KIND_META[s.kind].color }} />
              {s.name}
              <span className="font-mono text-[9px] text-zinc-600">{s.source}</span>
            </span>
          ))}
        </div>

        {isDdp && (
          <>
            <div className="flex items-center gap-2">
              <span className="w-12 font-mono text-[9px] text-zinc-500">TEST</span>
              <Segmented<TestPattern>
                mono
                className="flex-1"
                accent={pattern === 'off' ? '#10B981' : '#F59E0B'}
                value={pattern}
                onChange={(p) => setTestPattern(device.id, p)}
                options={TEST_PATTERNS.map((o) => ({ ...o, label: t(o.label) }))}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              {outputs.length === 0 && <span className="text-[10px] text-zinc-600">{t('No LED outputs mapped.')}</span>}
              {outputs.map((s) => (
                <div key={s.id} className="flex h-5 items-center gap-2 font-mono text-[10px]">
                  <span className="w-12 text-net">GPIO{s.gpio}</span>
                  <span className="min-w-0 flex-1 truncate font-sans text-[11px] text-zinc-400">{s.name}</span>
                  <span className="text-zinc-500">{s.chipset}</span>
                  <span className="w-9 text-right text-zinc-300">{s.ledCount}</span>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1.5 rounded-[5px] border border-line bg-inset p-2">
              <div className="flex items-center justify-between font-mono text-[10px]">
                <span className="text-zinc-500">{t('PSU LOAD')}</span>
                <span className={stats?.limited ? 'text-gps' : 'text-zinc-300'}>
                  {amps.toFixed(2)} / {device.psuMaxAmps.toFixed(1)} A · {(stats?.watts ?? 0).toFixed(1)} W
                </span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-[2px] bg-line">
                <div
                  className="absolute inset-y-0 left-0 transition-[width] duration-200"
                  style={{ width: `${loadPct * 100}%`, background: stats?.limited ? '#F59E0B' : '#10B981' }}
                />
                <div className="absolute inset-y-0 w-px bg-red-400" style={{ left: `${LIMITER_RATIO * 100}%` }} title={t('Limiter threshold')} />
              </div>
              <div className="flex items-center gap-1.5">
                <Segmented<'5' | '12'>
                  mono
                  className="w-[84px]"
                  accent="#F59E0B"
                  value={String(device.psuVoltage) as '5' | '12'}
                  onChange={(v) => set({ psuVoltage: v === '5' ? 5 : 12 })}
                  options={[
                    { value: '5', label: '5V' },
                    { value: '12', label: '12V' },
                  ]}
                />
                <ScrubInput
                  value={device.psuMaxAmps}
                  onChange={(psuMaxAmps) => set({ psuMaxAmps })}
                  min={0.5}
                  max={60}
                  step={0.1}
                  unit="A"
                  label="MAX"
                  accent="#F59E0B"
                  className="flex-1"
                />
                <Toggle checked={device.currentLimiter} onChange={(currentLimiter) => set({ currentLimiter })} color="#F59E0B" title={t('Automatic brightness limiter')} />
                <span className="font-mono text-[9px] text-zinc-500">ABL</span>
              </div>
              <div className="font-mono text-[10px] text-zinc-600">
                {t('full white {amps} A @ {volts}V', { amps: fullWhiteAmps.toFixed(2), volts: device.psuVoltage })}
                {stats?.limited && <span className="ml-1 text-gps">· {t('limiting')}</span>}
              </div>
            </div>
          </>
        )}
      </div>
    </Card>
  );
}

interface Discovered {
  host: string;
  ip: string;
  service: string;
  known: boolean;
}

function MdnsPanel() {
  const devices = useVoxel((s) => s.devices);
  const { addDevice } = useVoxelActions();
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Discovered[]>([]);

  const scan = () => {
    setScanning(true);
    setFound([]);
    window.setTimeout(() => {
      const known = devices.map((d) => ({
        host: `${d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.local`,
        ip: d.ip,
        service: d.protocol === 'DDP' ? '_wled._tcp' : '_osc._udp',
        known: true,
      }));
      const extra: Discovered = { host: 'wled-cuisine.local', ip: '192.168.1.51', service: '_wled._tcp', known: devices.some((d) => d.ip === '192.168.1.51') };
      setFound([...known, extra]);
      setScanning(false);
    }, 900);
  };

  const adopt = (d: Discovered) =>
    addDevice({
      id: uid('esp'),
      name: 'ESP32-Cuisine',
      chip: 'ESP32-WROOM-32E',
      ip: d.ip,
      mac: 'C8:2B:96:0F:A1:3E',
      port: DDP_PORT,
      protocol: 'DDP',
      firmware: 'WLED',
      psuVoltage: 5,
      psuMaxAmps: 4,
      currentLimiter: true,
      online: true,
    });

  return (
    <Card className="flex flex-col">
      <SectionHeader
        title={t('mDNS Discovery')}
        icon={Radar}
        right={
          <button
            type="button"
            onClick={scan}
            disabled={scanning}
            className="flex h-6 items-center gap-1 rounded-[5px] border border-net/40 px-2 text-[10px] text-net disabled:opacity-50"
          >
            <Wifi size={11} /> {scanning ? t('Browsing…') : t('Browse')}
          </button>
        }
      />
      <div className="flex flex-col gap-0.5 p-2">
        {found.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-zinc-600">
            {scanning ? t('Querying _wled._tcp.local and _osc._udp.local…') : t('Browse the LAN for WLED and OSC nodes. Results are simulated in this build.')}
          </p>
        )}
        {found.map((d) => (
          <div key={d.host} className="flex h-7 items-center gap-2 rounded-[4px] px-1 font-mono text-[10px] hover:bg-inset">
            <Plug size={11} className={d.known ? 'text-zinc-600' : 'text-net'} />
            <span className="min-w-0 flex-1 truncate text-zinc-300">{d.host}</span>
            <span className="text-zinc-500">{d.service}</span>
            <span className="w-24 text-right text-zinc-400">{d.ip}</span>
            {d.known ? (
              <span className="w-14 text-right text-zinc-600">{t('mapped')}</span>
            ) : (
              <button type="button" onClick={() => adopt(d)} className="w-14 rounded-[4px] border border-net/40 py-0.5 text-net">
                {t('Adopt')}
              </button>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

const HEADER_FIELDS: { label: string; span: number }[] = [
  { label: 'FLAGS', span: 1 },
  { label: 'SEQ', span: 1 },
  { label: 'TYPE', span: 1 },
  { label: 'DEST', span: 1 },
  { label: 'OFFSET u32 BE', span: 4 },
  { label: 'LEN u16 BE', span: 2 },
];
/** First header byte of each field. */
const FIELD_START = HEADER_FIELDS.map((_, i) => HEADER_FIELDS.slice(0, i).reduce((n, f) => n + f.span, 0));

function DdpInspector() {
  const devices = useVoxel((s) => s.devices);
  const ddpDevices = devices.filter((d) => d.protocol === 'DDP');
  const [deviceId, setDeviceId] = useState(ddpDevices[0]?.id ?? '');
  const [paused, setPaused] = useState(false);
  const [pktIndex, setPktIndex] = useState(0);
  const [frame, setFrame] = useState<DeviceFrame | null>(null);

  useEffect(() => {
    if (paused) return;
    const read = () => setFrame(runtime.frames.get(deviceId) ?? null);
    read();
    const id = window.setInterval(read, 100);
    return () => window.clearInterval(id);
  }, [deviceId, paused]);

  const pkt = frame?.packets[Math.min(pktIndex, (frame?.packets.length ?? 1) - 1)];
  const header = pkt ? Array.from(pkt.subarray(0, DDP_HEADER_LEN)) : [];
  const payload = pkt ? pkt.subarray(DDP_HEADER_LEN) : new Uint8Array();
  const flags = header[0] ?? 0;
  const offset = header.length ? ((header[4] << 24) | (header[5] << 16) | (header[6] << 8) | header[7]) >>> 0 : 0;
  const length = header.length ? (header[8] << 8) | header[9] : 0;
  const dumpRows = [];
  for (let r = 0; r < Math.min(6, Math.ceil(payload.length / 16)); r++) dumpRows.push(payload.subarray(r * 16, r * 16 + 16));
  const pixels: string[] = [];
  for (let i = 0; i + 2 < payload.length; i += 3) pixels.push(`rgb(${payload[i]},${payload[i + 1]},${payload[i + 2]})`);

  return (
    <Card className="flex flex-col">
      <SectionHeader
        title={t('UDP DDP Frame Inspector')}
        icon={Binary}
        right={
          <>
            <select
              value={deviceId}
              onChange={(e) => {
                setDeviceId(e.target.value);
                setPktIndex(0);
              }}
              className="h-6 rounded-[5px] border border-line bg-inset pl-2 pr-5 font-mono text-[10px] text-zinc-300"
            >
              {ddpDevices.map((d) => (
                <option key={d.id} value={d.id} className="bg-panel">
                  {d.name} · {d.ip}:{d.port}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setPaused((p) => !p)}
              className="flex h-6 items-center gap-1 rounded-[5px] border border-line px-2 text-[10px] text-zinc-300 hover:border-line-hi"
            >
              {paused ? <Play size={11} /> : <Pause size={11} />}
              {paused ? t('Resume') : t('Freeze')}
            </button>
          </>
        }
      />
      {!frame || !pkt ? (
        <p className="p-3 text-[11px] text-zinc-600">{t('No frame yet for this device. Map at least one LED segment to it.')}</p>
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {frame.packets.map((p, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setPktIndex(i)}
                className={`h-6 rounded-[4px] border px-2 font-mono text-[10px] ${i === pktIndex ? 'border-net/60 bg-net/10 text-net' : 'border-line text-zinc-500 hover:border-line-hi'}`}
              >
                {t('PKT {i} · {bytes} B', { i, bytes: p.length })}
                {i === frame.packets.length - 1 ? ' · PUSH' : ''}
              </button>
            ))}
            <span className="ml-auto font-mono text-[10px] text-zinc-500">
              {t('{px} px · {bytes} B payload', { px: frame.rgb.length / 3, bytes: frame.rgb.length })} ·{' '}
              {bridgeMode === 'native' ? t('sent via Rust UdpSocket') : t('encoded locally, send simulated')}
            </span>
          </div>

          <div className="grid grid-cols-10 gap-1">
            {HEADER_FIELDS.map((f, fi) => {
              const start = FIELD_START[fi];
              return (
                <div key={f.label} className="flex flex-col gap-1" style={{ gridColumn: `span ${f.span}` }}>
                  <div className="flex gap-1">
                    {header.slice(start, start + f.span).map((b, i) => (
                      <div key={i} className="flex h-9 flex-1 flex-col items-center justify-center rounded-[4px] border border-line bg-inset">
                        <span className="font-mono text-[13px] text-net">{toHex(b)}</span>
                        <span className="font-mono text-[8px] text-zinc-600">{start + i}</span>
                      </div>
                    ))}
                  </div>
                  <span className="text-center font-mono text-[9px] text-zinc-500">{f.label}</span>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px] text-zinc-400 md:grid-cols-6">
            <span>
              ver <span className="text-zinc-200">{(flags >> 6) & 0x3}</span>
            </span>
            <span>
              push <span className={flags & 1 ? 'text-net' : 'text-zinc-600'}>{flags & 1 ? t('yes') : t('no')}</span>
            </span>
            <span>
              seq <span className="text-zinc-200">{header[1] & 0x0f}</span>
            </span>
            <span>
              type <span className="text-zinc-200">{t('RGB 8-bit')}</span>
            </span>
            <span>
              offset <span className="text-zinc-200">{offset}</span>
            </span>
            <span>
              len <span className="text-zinc-200">{length}</span>
            </span>
          </div>

          <div className="rounded-[5px] border border-line bg-inset p-2 font-mono text-[10px] leading-5">
            {dumpRows.map((row, r) => (
              <div key={r} className="flex gap-3">
                <span className="text-zinc-600">{(offset + r * 16).toString(16).toUpperCase().padStart(6, '0')}</span>
                <span className="flex-1 tracking-wide text-zinc-300">{Array.from(row, toHex).join(' ')}</span>
              </div>
            ))}
            {payload.length > 96 && <div className="text-zinc-600">{t('… {n} more bytes', { n: payload.length - 96 })}</div>}
          </div>

          <div className="flex flex-wrap gap-px rounded-[5px] border border-line bg-black p-1.5">
            {pixels.map((c, i) => (
              <span key={i} className="h-2 w-2" style={{ background: c }} />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

const newDevice = (n: number): ESP32Device => ({
  id: uid('esp'),
  name: `ESP32-${String(n).padStart(2, '0')}`,
  chip: 'ESP32-WROOM-32E',
  ip: '192.168.1.100',
  mac: '00:00:00:00:00:00',
  port: DDP_PORT,
  protocol: 'DDP',
  firmware: 'WLED',
  psuVoltage: 5,
  psuMaxAmps: 4,
  currentLimiter: true,
  online: false,
});

export function DeviceFleetView() {
  const devices = useVoxel((s) => s.devices);
  const { addDevice } = useVoxelActions();
  const stats = useVoxel((s) => s.stats);
  const strips = useVoxel((s) => s.strips);
  const online = devices.filter((d) => d.online).length;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-3 p-4">
        <div className="flex items-center gap-4">
          <Cpu size={14} className="text-net" />
          <span className="text-[13px] font-medium text-zinc-200">{t('ESP32 Fleet')}</span>
          <span className="font-mono text-[11px] text-zinc-500">
            {t('{online}/{total} online', { online, total: devices.length })} · {strips.reduce((n, s) => n + s.ledCount, 0)} px · {stats.totalWatts.toFixed(1)} W · DDP {DDP_PORT}
            /udp
          </span>
          <button
            type="button"
            title={t('Add a WLED controller (output starts disabled until you set its IP)')}
            onClick={() => addDevice(newDevice(devices.length + 1))}
            className="ml-auto flex h-6 items-center gap-1 rounded-[5px] border border-net/40 px-2 text-[10px] text-net"
          >
            <Plus size={11} /> {t('Add device')}
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {devices.map((d) => (
            <DeviceCard key={d.id} device={d} />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_420px]">
          <DdpInspector />
          <MdnsPanel />
        </div>
      </div>
    </div>
  );
}
