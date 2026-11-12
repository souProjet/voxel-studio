import { useRef, type PointerEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

type Icon = LucideIcon;

export function SectionHeader({ title, icon: I, right, accent }: { title: string; icon?: Icon; right?: ReactNode; accent?: string }) {
  return (
    <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-line px-3">
      {I && <I size={12} strokeWidth={1.75} className="text-zinc-500" />}
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400" style={accent ? { color: accent } : undefined}>
        {title}
      </span>
      <div className="ml-auto flex items-center gap-1">{right}</div>
    </div>
  );
}

export function IconButton({
  icon: I,
  onClick,
  title,
  active,
  danger,
  size = 'sm',
}: {
  icon: Icon;
  onClick: () => void;
  title: string;
  active?: boolean;
  danger?: boolean;
  size?: 'sm' | 'md';
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`flex shrink-0 items-center justify-center rounded-[5px] border transition-colors ${size === 'sm' ? 'h-6 w-6' : 'h-7 w-7'} ${
        active
          ? 'border-spatial/50 bg-spatial/10 text-spatial'
          : danger
            ? 'border-transparent text-zinc-500 hover:border-red-500/40 hover:text-red-400'
            : 'border-transparent text-zinc-500 hover:border-line hover:bg-card hover:text-zinc-200'
      }`}
    >
      <I size={13} strokeWidth={1.75} />
    </button>
  );
}

export function Toggle({ checked, onChange, color = '#06B6D4', title }: { checked: boolean; onChange: (v: boolean) => void; color?: string; title?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      title={title}
      onClick={() => onChange(!checked)}
      className="relative h-4 w-7 shrink-0 rounded-full border border-line bg-inset transition-colors"
      style={checked ? { background: `${color}26`, borderColor: `${color}80` } : undefined}
    >
      <span
        className="absolute top-[2px] h-2.5 w-2.5 rounded-full transition-all"
        style={{ left: checked ? 13 : 2, background: checked ? color : '#52525b' }}
      />
    </button>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: string;
  icon?: Icon;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  accent = '#06B6D4',
  className = '',
  mono,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  accent?: string;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={`flex h-7 items-stretch gap-0.5 rounded-[5px] border border-line bg-inset p-0.5 ${className}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`flex flex-1 items-center justify-center gap-1 rounded-[3px] px-1.5 text-[10px] font-medium uppercase tracking-wide transition-colors ${
              mono ? 'font-mono' : ''
            } ${on ? 'bg-card text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            style={on ? { boxShadow: `inset 0 0 0 1px ${accent}55`, color: accent } : undefined}
          >
            {o.icon && <o.icon size={11} strokeWidth={1.75} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-1.5">
      <span className="w-[62px] shrink-0 truncate text-[11px] text-zinc-500">{label}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">{children}</div>
      {hint}
    </div>
  );
}

export function TextInput({ value, onChange, mono, placeholder }: { value: string; onChange: (v: string) => void; mono?: boolean; placeholder?: string }) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`h-7 w-full min-w-0 rounded-[5px] border border-line bg-inset px-2 text-[11px] text-zinc-200 transition-colors hover:border-line-hi focus:border-spatial/70 ${
        mono ? 'font-mono' : ''
      }`}
    />
  );
}

export function Select<T extends string>({ value, onChange, options, mono }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; mono?: boolean }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className={`h-7 w-full min-w-0 cursor-pointer rounded-[5px] border border-line bg-inset pl-2 pr-5 text-[11px] text-zinc-200 hover:border-line-hi ${mono ? 'font-mono' : ''}`}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-panel">
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Horizontal bar slider: press anywhere to jump, drag to adjust. */
export function SliderBar({
  value,
  min = 0,
  max = 1,
  onChange,
  color = '#06B6D4',
  disabled,
  bipolar,
  height = 'h-5',
}: {
  value: number;
  min?: number;
  max?: number;
  onChange?: (v: number) => void;
  color?: string;
  disabled?: boolean;
  bipolar?: boolean;
  height?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const interactive = !!onChange && !disabled;
  const pct = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const zero = bipolar ? Math.max(0, Math.min(1, (0 - min) / (max - min))) : 0;

  const fromEvent = (e: PointerEvent<HTMLDivElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onChange?.(min + t * (max - min));
  };

  return (
    <div
      ref={ref}
      className={`relative ${height} w-full overflow-hidden rounded-[4px] border border-line bg-inset ${interactive ? 'cursor-ew-resize hover:border-line-hi' : ''}`}
      onPointerDown={(e) => {
        if (!interactive) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        fromEvent(e);
      }}
      onPointerMove={(e) => {
        if (interactive && e.currentTarget.hasPointerCapture(e.pointerId)) fromEvent(e);
      }}
    >
      <div
        className="absolute inset-y-0"
        style={{
          left: `${Math.min(pct, zero) * 100}%`,
          width: `${Math.abs(pct - zero) * 100}%`,
          background: `${color}40`,
          borderRight: !bipolar || pct >= zero ? `2px solid ${color}` : undefined,
          borderLeft: bipolar && pct < zero ? `2px solid ${color}` : undefined,
        }}
      />
      {bipolar && <div className="absolute inset-y-0 w-px bg-zinc-600" style={{ left: `${zero * 100}%` }} />}
    </div>
  );
}

export function Stat({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <span className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</span>
      <span className="tabular font-mono text-[11px] font-medium" style={{ color: color ?? '#e4e4e7' }}>
        {value}
      </span>
      {unit && <span className="font-mono text-[10px] text-zinc-500">{unit}</span>}
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-md border border-line bg-card ${className}`}>{children}</div>;
}
