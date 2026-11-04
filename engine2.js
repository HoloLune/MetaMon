// "Nuovo" engine: the mGBA libretro core compiled by us (core/mgba.wasm) with a tiny frontend.
// No RetroArch and no Asyncify: a 30 Hz timer runs 2 emulated frames, draws the newest picture
// with WebGL and streams the sound to an AudioWorklet. Same API as engine.js.
const IDX = { b: 0, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, l: 10, r: 11 };
const TICK_MS = 1000 / 30;
const VERSION = '22';

let M = null, loaded = false, timer = 0, paused = false;
let keys = 0, tapped = 0, speedMul = 1, volume = 1;   // tapped: pressed since the last tick (a quick tap is never lost)
let fps = 59.7275, frameMs = 1000 / fps;
let gl = null, tex = null, texW = 256, texH = 256, canvas = null, resizeObs = null;
let actx = null, node = null, gain = null, srcRate = 32768;
let queuedSec = 0, queuedAt = 0;   // audio buffered in the worklet, as last reported
let restoredLen = 0, underruns = 0, gamma = 1;

export const isRunning = () => loaded;

export async function start(name, bytes, onProgress, opts = {}) {
  onProgress?.('Avvio del motore nuovo…');
  const { default: create } = await import(`./core/mgba.js?v=${VERSION}`);
  M = await create({ locateFile: (f) => new URL(`core/${f}?v=${VERSION}`, location.href).href });
  M._mm_init();
  const p = M._malloc(bytes.length);          // the core reads the ROM from here: never freed
  M.HEAPU8.set(bytes, p);
  if (!M._mm_load(p, bytes.length, 1)) throw new Error('ROM non riconosciuta');
  fps = M._mm_fps() || fps; frameMs = 1000 / fps;
  srcRate = M._mm_sample_rate() || srcRate;
  setupVideo();
  await setupAudio();
  loaded = true;
  loop();
}

// ---------- main loop ----------
let owed = 0, last = 0;
function loop() {
  clearTimeout(timer);
  timer = setTimeout(loop, TICK_MS);
  if (paused) return;
  const now = performance.now();
  owed += (last ? Math.min(now - last, 250) : TICK_MS) * speedMul; last = now;
  let n = Math.round(owed / frameMs);
  // keep about 0.1 s of sound queued: run a frame more or less when the audio clock drifts
  if (speedMul === 1 && actx?.state === 'running') {
    const q = queuedSec - (now - queuedAt) / 1000;
    if (q < 0.08) n += 1; else if (q > 0.25) n -= 1;
  }
  n = Math.max(0, Math.min(4 * speedMul, n));
  owed = Math.max(-frameMs, Math.min(owed - n * frameMs, 3 * frameMs * speedMul));
  if (!n) return;
  M._mm_set_keys(keys | tapped); tapped = 0;
  M._mm_run(n);
  if (M._mm_frame_new()) draw();
  pushAudio();
}

// ---------- video ----------
const VS = 'attribute vec2 p;varying vec2 t;uniform vec2 s;void main(){t=(p*vec2(.5,-.5)+.5)*s;gl_Position=vec4(p,0.,1.);}';
// g < 1 lifts dark tones: on the additive display dark colours are nearly invisible
const FS = 'precision mediump float;varying vec2 t;uniform sampler2D x;uniform float g;void main(){gl_FragColor=vec4(pow(texture2D(x,t).rgb,vec3(g)),1.);}';
function setupVideo() {
  const host = document.querySelector('#ejs');
  host.textContent = '';
  canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:100%;height:100%;display:block;image-rendering:pixelated';
  host.appendChild(canvas);
  gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, texW, texH, 0, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, null);
  gl.uniform1i(gl.getUniformLocation(prog, 'x'), 0);
  canvas.__scale = gl.getUniformLocation(prog, 's');
  canvas.__gamma = gl.getUniformLocation(prog, 'g');
  gl.uniform1f(canvas.__gamma, gamma);
  const fit = () => {
    // layout size (not the transformed one: in Eco mode the compositor does the scaling)
    canvas.width = Math.max(1, canvas.offsetWidth); canvas.height = Math.max(1, canvas.offsetHeight);
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (M?._mm_frame_ptr()) draw();
  };
  resizeObs = new ResizeObserver(fit); resizeObs.observe(canvas); fit();
}
let lastW = 0, lastH = 0;
function draw() {
  const ptr = M._mm_frame_ptr(); if (!ptr) return;
  const w = M._mm_frame_w(), h = M._mm_frame_h(), rowPx = M._mm_frame_pitch() >> 1;
  if (rowPx > texW || h > texH) return;
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, rowPx, h, gl.RGB, gl.UNSIGNED_SHORT_5_6_5, M.HEAPU16.subarray(ptr >> 1, (ptr >> 1) + rowPx * h));
  if (w !== lastW || h !== lastH) { lastW = w; lastH = h; gl.uniform2f(canvas.__scale, w / texW, h / texH); }
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ---------- audio ----------
// One continuous stream: a worklet resamples the core's 16-bit stereo to the device rate.
const WORKLET = `
class P extends AudioWorkletProcessor {
  constructor(o) { super(); this.src = o.processorOptions.src; this.step = this.src / sampleRate; this.q = []; this.cur = null; this.i = 0; this.pos = 0; this.len = 0; this.n = 0; this.under = 0;
    this.port.onmessage = (e) => { if (e.data === 'clear') { this.q = []; this.cur = null; this.len = 0; return; }
      this.q.push(e.data); this.len += e.data.length / 2;
      while (this.len > o.processorOptions.src * 0.4 && this.q.length > 1) this.len -= this.q.shift().length / 2; }; }
  process(_, out) {
    const L = out[0][0], R = out[0][1] || out[0][0];
    for (let k = 0; k < L.length; k++) {
      while (!this.cur || this.i >= this.cur.length / 2) { if (this.cur) this.len -= this.cur.length / 2; this.cur = this.q.shift(); this.i = 0; if (!this.cur) break; }
      if (!this.cur) { L[k] = R[k] = 0; this.under++; continue; }
      const j = this.i | 0; L[k] = this.cur[2 * j]; R[k] = this.cur[2 * j + 1];
      this.i += this.step;
    }
    if (++this.n % 12 === 0) this.port.postMessage([(this.len - (this.cur ? this.i : 0)) / this.src, this.under]);   // seconds queued, silent samples so far
    return true;
  }
}
registerProcessor('mm-audio', P);`;
async function setupAudio() {
  try {
    actx = new AudioContext({ latencyHint: 'playback' });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'text/javascript' }));
    await actx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(actx, 'mm-audio', { outputChannelCount: [2], processorOptions: { src: srcRate } });
    node.port.onmessage = (e) => { queuedSec = e.data[0]; underruns = e.data[1]; queuedAt = performance.now(); };
    gain = actx.createGain(); gain.gain.value = volume;
    node.connect(gain).connect(actx.destination);
  } catch (e) { console.warn('audio', e); node = null; }
}
function pushAudio() {
  const n = M._mm_audio_take();
  if (!n || !node || speedMul !== 1 || actx.state !== 'running') return;
  const p = M._mm_audio_ptr() >> 1, s = M.HEAP16, f = new Float32Array(n * 2);
  for (let i = 0; i < n * 2; i++) f[i] = s[p + i] * (1 / 32768);
  node.port.postMessage(f, [f.buffer]);
}

// ---------- API used by app.js ----------
export function frameCount() { return M ? M._mm_frames() : 0; }
export function press(b) { keys |= 1 << IDX[b]; tapped |= 1 << IDX[b]; }
export function release(b) { keys &= ~(1 << IDX[b]); }
export function pause() { paused = true; try { actx?.suspend(); } catch {} }
export function resume() { paused = false; last = 0; resumeAudio(); }
export function setSpeed(x2) { speedMul = x2 ? 2 : 1; if (x2) node?.port.postMessage('clear'); }
export function setVolume(v) { volume = v; if (gain) gain.gain.value = v; }
export function resumeAudio() { try { if (actx && actx.state !== 'running' && !paused) actx.resume(); } catch {} }
export function getState() {
  const size = M._mm_state_size(), p = M._malloc(size);
  try { if (!M._mm_state_save(p, size)) throw new Error('stato non salvato'); return wrapRetroArchState(M.HEAPU8.subarray(p, p + size)); }
  finally { M._free(p); }
}
export function loadState(bytes) {
  const data = unwrapRetroArchState(bytes);
  const p = M._malloc(data.length);
  try { M.HEAPU8.set(data, p); if (!M._mm_state_load(p, data.length)) throw new Error('stato non caricato'); }
  finally { M._free(p); }
}
export function getSave() {
  const p = M._mm_save_ptr(); let size = M._mm_save_size();
  if (!p || !size) return null;
  // the core reports the largest flash size until the game touches its save chip: trim back to the
  // restored size when everything past it is still untouched
  if (restoredLen && size > restoredLen) {
    let untouched = true;
    for (let i = p + restoredLen; i < p + size; i++) if (M.HEAPU8[i] !== 0xff) { untouched = false; break; }
    if (untouched) size = restoredLen;
  }
  return M.HEAPU8.slice(p, p + size);
}
export function restoreSave(bytes) {
  const p = M._mm_save_ptr(), size = M._mm_save_size();
  if (!p || !size) throw new Error('nessuna memoria di salvataggio');
  M.HEAPU8.set(bytes.subarray(0, size), p);
  restoredLen = Math.min(bytes.length, size);
}
export function setBrightness(level) { gamma = [1, 0.75, 0.55][level] ?? 1; if (gl) { gl.uniform1f(canvas.__gamma, gamma); draw(); } }
export const liveScreen = true;   // screen modes change without restarting

// RetroArch wraps states in "RASTATE" blocks; the core data is the "MEM " block.
// We write the same format so states stay interchangeable with the classic engine.
function wrapRetroArchState(mem) {
  const pad = (mem.length + 7) & ~7, out = new Uint8Array(8 + 8 + pad + 8), dv = new DataView(out.buffer);
  out.set([82, 65, 83, 84, 65, 84, 69, 1]);               // "RASTATE" v1
  out.set([77, 69, 77, 32], 8); dv.setUint32(12, mem.length, true); out.set(mem, 16);
  out.set([69, 78, 68, 32], 16 + pad);                     // "END " (size 0)
  return out;
}
function unwrapRetroArchState(b) {
  const tag = String.fromCharCode(...b.subarray(0, 7));
  if (tag !== 'RASTATE') return b;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let o = 8;
  while (o + 8 <= b.length) {
    const id = String.fromCharCode(...b.subarray(o, o + 4)), len = dv.getUint32(o + 4, true);
    if (id === 'MEM ') return b.subarray(o + 8, o + 8 + len);
    if (id === 'END ') break;
    o += 8 + ((len + 7) & ~7);
  }
  return b;
}
// seconds of sound waiting in the worklet (for tests / diagnostics)
export function audioQueued() { return actx?.state === 'running' ? queuedSec - (performance.now() - queuedAt) / 1000 : null; }
export function audioUnderruns() { return underruns; }
