import type { BlendMode, PaletteId, Vec3 } from '../types/voxel';
import type { LedLayout } from './geometry';
import { BLEND_INDEX, EPILOGUE, PRELUDE, PRELUDE_LINES } from './layers';
import { paletteLut } from './shaderMath';

/** One layer ready to draw: modulation already applied. */
export interface LayerDraw {
  id: string;
  code: string;
  blend: BlendMode;
  opacity: number;
  /** Per-segment flags (1 = drawn), or null for every segment. */
  mask: Uint8Array | null;
  floats: Record<string, number>;
  colors: Record<string, [number, number, number]>;
}

export interface SceneUniforms {
  time: number;
  phase: number;
  beat: number;
  bpm: number;
  radius: number;
  hue: number;
  origin: Vec3;
  room: Vec3;
  palette: PaletteId;
  fadeSec: number;
}

interface Program {
  prog: WebGLProgram;
  loc: Map<string, WebGLUniformLocation | null>;
}

/** Per layer: the shader on screen, and the one it is crossfading from. */
interface LayerState {
  code: string;
  prev: string | null;
  fadeStart: number;
}

const TEX_W = 256;
const VERT = `#version 300 es
in vec2 a;
void main() { gl_Position = vec4(a, 0.0, 1.0); }`;
const BUILTIN_FLOATS = ['TIME', 'PHASE', 'BEAT', 'BPM', 'RADIUS', 'HUE'] as const;

/**
 * Renders the layer stack on the GPU: the LED positions live in a float texture, one fragment per
 * LED, each layer drawn in order with fixed-function blending, then read back for DDP output.
 */
export class LayerRenderer {
  private gl: WebGL2RenderingContext;
  private programs = new Map<string, Program>();
  /** Compiler output per code string; absent when the code compiled. */
  readonly errors = new Map<string, string>();
  private states = new Map<string, LayerState>();
  private posTex: WebGLTexture;
  private paletteTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private target: WebGLTexture;
  private fbo: WebGLFramebuffer;
  private pixels = new Uint8Array(4);
  private h = 1;
  private count = 0;
  private palette: PaletteId | null = null;

  constructor() {
    const gl = new OffscreenCanvas(1, 1).getContext('webgl2', { antialias: false, depth: false, stencil: false, preserveDrawingBuffer: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.posTex = this.texture();
    this.paletteTex = this.texture(gl.LINEAR, gl.REPEAT);
    this.maskTex = this.texture();
    this.target = this.texture();
    this.fbo = gl.createFramebuffer()!;
    this.resize(1);
  }

  private texture(filter: number = WebGL2RenderingContext.NEAREST, wrap: number = WebGL2RenderingContext.CLAMP_TO_EDGE) {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  private resize(rows: number) {
    const gl = this.gl;
    this.h = rows;
    this.pixels = new Uint8Array(TEX_W * rows * 4);
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, TEX_W, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
  }

  /** Uploads LED positions; w packs the segment index and the position along it. */
  setLayout(layout: LedLayout) {
    const gl = this.gl;
    const n = layout.total;
    const rows = Math.max(1, Math.ceil(n / TEX_W));
    if (rows !== this.h) this.resize(rows);
    const data = new Float32Array(TEX_W * rows * 4);
    layout.ranges.forEach((r, s) => {
      for (let i = r.start, e = r.start + r.count; i < e; i++) {
        data.set(layout.positions.subarray(i * 3, i * 3 + 3), i * 4);
        data[i * 4 + 3] = s + (r.count > 1 ? ((i - r.start) / (r.count - 1)) * 0.999 : 0);
      }
    });
    gl.bindTexture(gl.TEXTURE_2D, this.posTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, TEX_W, rows, 0, gl.RGBA, gl.FLOAT, data);
    this.count = n;
  }

  /** Compiles (once per code string) and returns the program, or null with the error recorded. */
  private program(code: string): Program | null {
    const hit = this.programs.get(code);
    if (hit) return hit;
    if (this.errors.has(code)) return null;
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return sh;
      const log = gl.getShaderInfoLog(sh) ?? 'compile error';
      gl.deleteShader(sh);
      throw new Error(log);
    };
    try {
      const vs = compile(gl.VERTEX_SHADER, VERT);
      const fs = compile(gl.FRAGMENT_SHADER, `${PRELUDE}${code}\n${EPILOGUE}`);
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.bindAttribLocation(prog, 0, 'a');
      gl.linkProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        const log = gl.getProgramInfoLog(prog) ?? 'link error';
        gl.deleteProgram(prog);
        throw new Error(log);
      }
      const p: Program = { prog, loc: new Map() };
      // Keep the cache bounded while someone live-codes: drop the oldest unused programs.
      if (this.programs.size > 48) {
        const live = new Set([...this.states.values()].flatMap((s) => [s.code, s.prev]));
        for (const [k, v] of this.programs) {
          if (live.has(k) || this.programs.size <= 32) continue;
          gl.deleteProgram(v.prog);
          this.programs.delete(k);
        }
      }
      this.programs.set(code, p);
      return p;
    } catch (e) {
      if (this.errors.size > 64) this.errors.clear();
      this.errors.set(code, formatGlslError(e instanceof Error ? e.message : String(e)));
      return null;
    }
  }

  private uniform(p: Program, name: string) {
    if (!p.loc.has(name)) p.loc.set(name, this.gl.getUniformLocation(p.prog, name));
    return p.loc.get(name)!;
  }

  private draw(code: string, layer: LayerDraw, opacity: number, scene: SceneUniforms) {
    const p = this.program(code);
    if (!p || opacity <= 0) return;
    const gl = this.gl;
    gl.useProgram(p.prog);
    const u = (name: string) => this.uniform(p, name);
    gl.uniform1i(u('uPos'), 0);
    gl.uniform1i(u('uPalette'), 1);
    gl.uniform1i(u('uMask'), 2);
    gl.uniform1i(u('COUNT'), this.count);
    gl.uniform1i(u('uMode'), BLEND_INDEX[layer.blend]);
    gl.uniform1f(u('uOpacity'), opacity);
    const builtins = { TIME: scene.time, PHASE: scene.phase, BEAT: scene.beat, BPM: scene.bpm, RADIUS: scene.radius, HUE: scene.hue };
    for (const k of BUILTIN_FLOATS) gl.uniform1f(u(k), builtins[k]);
    gl.uniform3fv(u('ORIGIN'), scene.origin);
    gl.uniform3fv(u('ROOM'), scene.room);
    for (const [k, v] of Object.entries(layer.floats)) gl.uniform1f(u(k), v);
    for (const [k, v] of Object.entries(layer.colors)) gl.uniform3fv(u(k), v);
    gl.uniform1i(u('uMasked'), layer.mask ? 1 : 0);
    if (layer.mask) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, layer.mask.length, 1, 0, gl.RED, gl.UNSIGNED_BYTE, layer.mask);
    }
    gl.blendEquation(layer.blend === 'max' ? gl.MAX : gl.FUNC_ADD);
    if (layer.blend === 'normal') gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    else if (layer.blend === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else if (layer.blend === 'screen') gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    else if (layer.blend === 'multiply') gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    else gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Renders the stack and writes linear RGB 0..1 for every LED into out. */
  render(layers: LayerDraw[], scene: SceneUniforms, out: Float32Array) {
    const gl = this.gl;
    if (scene.palette !== this.palette) {
      const lut = paletteLut(scene.palette);
      const rgba = new Uint8Array(256 * 4);
      for (let i = 0; i < 256; i++) for (let c = 0; c < 3; c++) rgba[i * 4 + c] = Math.round(lut[i * 3 + c] * 255);
      gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      this.palette = scene.palette;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, TEX_W, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.posTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    const seen = new Set<string>();
    for (const layer of layers) {
      seen.add(layer.id);
      let st = this.states.get(layer.id);
      // A new shader that compiles starts a crossfade; a broken one leaves the last good one running.
      if (this.program(layer.code)) {
        if (!st) this.states.set(layer.id, (st = { code: layer.code, prev: null, fadeStart: 0 }));
        else if (st.code !== layer.code) {
          st.prev = scene.fadeSec > 0 ? st.code : null;
          st.code = layer.code;
          st.fadeStart = scene.time;
        }
      }
      if (!st) continue;
      const k = st.prev ? Math.min(1, (scene.time - st.fadeStart) / scene.fadeSec) : 1;
      if (k >= 1) st.prev = null;
      if (st.prev) this.draw(st.prev, layer, layer.opacity * (1 - k), scene);
      this.draw(st.code, layer, layer.opacity * (st.prev ? k : 1), scene);
    }
    for (const id of this.states.keys()) if (!seen.has(id)) this.states.delete(id);

    gl.readPixels(0, 0, TEX_W, this.h, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
    const px = this.pixels;
    for (let i = 0, n = this.count; i < n; i++) {
      out[i * 3] = px[i * 4] / 255;
      out[i * 3 + 1] = px[i * 4 + 1] / 255;
      out[i * 3 + 2] = px[i * 4 + 2] / 255;
    }
  }

  dispose() {
    for (const p of this.programs.values()) this.gl.deleteProgram(p.prog);
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Rewrites "ERROR: 0:57: 'x' : undeclared identifier" to "line 3: 'x' : undeclared identifier". */
export function formatGlslError(log: string): string {
  return log
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = l.match(/^(?:ERROR|WARNING):\s*\d+:(\d+):\s*(.*)$/);
      if (!m) return l;
      const line = Number(m[1]) - PRELUDE_LINES;
      return line > 0 ? `line ${line}: ${m[2]}` : m[2];
    })
    .join('\n');
}
