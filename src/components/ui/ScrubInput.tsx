import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { AXIS_COLOR } from '../../services/catalog';

export interface ScrubInputProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** Decimal places shown; defaults to the precision of `step`. */
  precision?: number;
  unit?: string;
  label?: string;
  axis?: 'x' | 'y' | 'z';
  /** Accent for the label and range fill when no axis is set. */
  accent?: string;
  /** Read-only modulated value drawn as a tick over the range fill. */
  modulated?: number;
  /** Display multiplier (e.g. 100 to edit a 0..1 value as percent). */
  displayScale?: number;
  className?: string;
  title?: string;
}

const decimals = (step: number) => {
  const s = String(step);
  return s.includes('.') ? s.length - s.indexOf('.') - 1 : 0;
};

/**
 * Blender / Spline style numeric field: click-drag horizontally to scrub, click without
 * moving to type. Shift = fine (x0.1), Alt = coarse (x10). Enter commits, Escape cancels.
 */
export function ScrubInput({
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 0.01,
  precision,
  unit,
  label,
  axis,
  accent,
  modulated,
  displayScale = 1,
  className = '',
  title,
}: ScrubInputProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const drag = useRef<{ x0: number; v0: number; moved: boolean } | null>(null);
  const prec = precision ?? Math.max(0, decimals(step) - Math.round(Math.log10(displayScale)));
  const color = axis ? AXIS_COLOR[axis] : accent ?? '#71717a';
  const bounded = Number.isFinite(min) && Number.isFinite(max);
  const pct = (v: number) => (bounded ? Math.max(0, Math.min(1, (v - min) / (max - min))) * 100 : 0);

  const commitValue = (v: number) => {
    const q = Math.round(v / step) * step;
    const clamped = Math.max(min, Math.min(max, q));
    onChange(Number(clamped.toFixed(Math.max(decimals(step), 0))));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (editing || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x0: e.clientX, v0: value, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x0;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    const mult = e.shiftKey ? 0.1 : e.altKey ? 10 : 1;
    commitValue(d.v0 + dx * step * mult);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d && !d.moved) {
      setDraft((value * displayScale).toFixed(prec));
      setEditing(true);
    }
  };

  const finishEdit = (commit: boolean) => {
    if (commit) {
      const parsed = parseFloat(draft.replace(',', '.'));
      if (Number.isFinite(parsed)) commitValue(parsed / displayScale);
    }
    setEditing(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finishEdit(true);
    else if (e.key === 'Escape') finishEdit(false);
  };

  return (
    <div
      title={title}
      className={`group relative flex h-7 min-w-0 items-center overflow-hidden rounded-[5px] border border-line bg-inset transition-colors hover:border-line-hi ${
        editing ? 'border-spatial/70' : 'cursor-ew-resize'
      } ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {bounded && !editing && (
        <div className="pointer-events-none absolute inset-y-0 left-0 opacity-[0.13]" style={{ width: `${pct(value)}%`, background: color }} />
      )}
      {bounded && modulated !== undefined && !editing && Math.abs(modulated - value) > step / 2 && (
        <div className="pointer-events-none absolute inset-y-1 w-px bg-audio" style={{ left: `${pct(modulated)}%` }} />
      )}
      {label && (
        <span
          className="relative z-10 flex h-full shrink-0 items-center px-1.5 font-mono text-[10px] font-semibold"
          style={{ color, borderRight: axis ? `1px solid ${color}33` : undefined }}
        >
          {label}
        </span>
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finishEdit(true)}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          className="relative z-10 h-full w-full min-w-0 bg-transparent px-1.5 text-right font-mono text-[11px] text-zinc-100"
        />
      ) : (
        <span className="tabular relative z-10 ml-auto truncate px-1.5 font-mono text-[11px] text-zinc-200">
          {(value * displayScale).toFixed(prec)}
          {unit && <span className="ml-0.5 text-zinc-500">{unit}</span>}
        </span>
      )}
    </div>
  );
}
