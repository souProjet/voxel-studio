import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { BookOpen, Code2, X } from 'lucide-react';
import type { EffectLayer } from '../../types/voxel';
import { useVoxel, useVoxelActions } from '../../state/useVoxelStore';
import { SHADER_REFERENCE } from '../../services/layers';
import { t } from '../../i18n';

const COMMIT_MS = 250;
const LINE_H = 18;

function Editor({ layer, error }: { layer: EffectLayer; error: string | undefined }) {
  const { updateLayer, setCodeOpen } = useVoxelActions();
  // `base` is the code last committed to the store: a store change that matches neither the base nor the
  // draft came from elsewhere (preset, undo) and replaces the draft.
  const [draft, setDraft] = useState({ text: layer.code, base: layer.code });
  if (layer.code !== draft.base && layer.code !== draft.text) setDraft({ text: layer.code, base: layer.code });
  const [scroll, setScroll] = useState(0);
  const [showRef, setShowRef] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const change = (text: string) => {
    setDraft((d) => ({ ...d, text }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      updateLayer(layer.id, { code: text });
      setDraft((d) => ({ ...d, base: text }));
    }, COMMIT_MS);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      setCodeOpen(false);
      return;
    }
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const { selectionStart: a, selectionEnd: b, value } = el;
    const next = `${value.slice(0, a)}  ${value.slice(b)}`;
    change(next);
    requestAnimationFrame(() => el.setSelectionRange(a + 2, a + 2));
  };

  const lines = draft.text.split('\n').length;
  const errorLines = new Set([...(error ?? '').matchAll(/line (\d+):/g)].map((m) => Number(m[1])));
  const pending = draft.text !== layer.code;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
        <Code2 size={13} className="text-[#a78bfa]" />
        <span className="truncate text-[12px] font-medium text-zinc-100">{layer.name}</span>
        <span className="font-mono text-[10px] text-zinc-500">GLSL ES 3.00</span>
        <span
          className={`ml-1 h-1.5 w-1.5 rounded-full ${error ? 'bg-red-500' : pending ? 'bg-amber-400' : 'bg-net'}`}
          title={error ? t('Shader error') : pending ? t('Compiling') : t('Running')}
        />
        <span className="ml-auto" />
        <button
          type="button"
          onClick={() => setShowRef(!showRef)}
          className={`flex h-6 items-center gap-1 rounded-[5px] border px-2 text-[10px] ${showRef ? 'border-[#a78bfa]/60 text-[#c4b5fd]' : 'border-line text-zinc-400'}`}
        >
          <BookOpen size={11} /> {t('Reference')}
        </button>
        <button type="button" title={t('Close (Esc)')} onClick={() => setCodeOpen(false)} className="grid h-6 w-6 place-items-center rounded-[5px] text-zinc-400 hover:bg-white/5">
          <X size={13} />
        </button>
      </div>
      {showRef && (
        <div className="max-h-[45%] shrink-0 overflow-y-auto border-b border-line bg-inset px-3 py-2">
          {SHADER_REFERENCE.map(([sig, doc]) => (
            <div key={sig} className="flex gap-3 py-0.5 text-[10.5px]">
              <code className="w-[190px] shrink-0 font-mono text-[#c4b5fd]">{sig}</code>
              <span className="text-zinc-400">{t(doc)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="relative flex min-h-0 flex-1 overflow-hidden bg-[#0b0b0e] font-mono text-[12px]">
        <div className="w-10 shrink-0 select-none overflow-hidden border-r border-line text-right text-zinc-600">
          <div style={{ transform: `translateY(${8 - scroll}px)` }}>
            {Array.from({ length: lines }, (_, i) => (
              <div key={i} className={`pr-2 ${errorLines.has(i + 1) ? 'bg-red-500/20 text-red-300' : ''}`} style={{ height: LINE_H, lineHeight: `${LINE_H}px` }}>
                {i + 1}
              </div>
            ))}
          </div>
        </div>
        <textarea
          value={draft.text}
          onChange={(e) => change(e.target.value)}
          onKeyDown={onKeyDown}
          onScroll={(e) => setScroll(e.currentTarget.scrollTop)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          wrap="off"
          className="min-w-0 flex-1 resize-none bg-transparent px-3 py-2 text-zinc-200 caret-[#a78bfa] outline-none selection:bg-[#a78bfa]/30"
          style={{ lineHeight: `${LINE_H}px`, tabSize: 2, userSelect: 'text' }}
        />
      </div>
      <div
        className={`max-h-28 shrink-0 overflow-y-auto border-t px-3 py-1.5 font-mono text-[10.5px] ${error ? 'border-red-500/40 bg-red-500/10 text-red-300' : 'border-line text-zinc-500'}`}
      >
        {error ? <pre className="whitespace-pre-wrap">{error}</pre> : t('Compiles as you type; the last working version keeps running while the code has errors.')}
      </div>
    </div>
  );
}

/** Live GLSL editor for the selected layer, over the left of the viewport so the result stays visible. */
export function ShaderEditor() {
  const open = useVoxel((s) => s.codeOpen);
  const layer = useVoxel((s) => s.layers.find((l) => l.id === s.selectedLayerId) ?? null);
  const error = useVoxel((s) => (s.selectedLayerId ? s.shaderErrors[s.selectedLayerId] : undefined));
  if (!open || !layer) return null;
  return (
    <div className="absolute inset-y-0 left-0 z-20 w-[min(560px,60%)] border-r border-line bg-panel/95 shadow-2xl shadow-black/60 backdrop-blur">
      <Editor key={layer.id} layer={layer} error={error} />
    </div>
  );
}
