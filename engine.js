// GBA engine: mGBA libretro core packaged by EmulatorJS (single-threaded WebAssembly,
// so it runs without cross-origin isolation / SharedArrayBuffer).
// EmulatorJS's own UI and keyboard handling are disabled; MetaMon drives it.
const IDX = { b: 0, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, l: 10, r: 11 };

// The glasses display refreshes at 30 Hz: wake up 30 times a second and run 2 emulated frames each time
// (60 fps game speed). Was a setImmediate spin, ~350 wakeups/s.
const LOOP_MS = 1000 / 30;
const MIN_SLEEP_MS = 8;
const ITERS_PER_TICK = 2;
const FRAME_MS = 1000 / 59.7275;   // GBA refresh rate
let speedMul = 1;                   // 2 while fast-forwarding
function catchUp() {
  let owed = 0, last = 0;
  const f = () => {
    const now = performance.now();
    owed += (last ? now - last : FRAME_MS * ITERS_PER_TICK) * speedMul; last = now;
    return Math.max(1, Math.min(4 * speedMul, Math.round(owed / FRAME_MS)));
  };
  f.done = (ran) => { owed = Math.max(-FRAME_MS, Math.min(owed - ran * FRAME_MS, 3 * FRAME_MS * speedMul)); };
  return f;
}
let ejs = null;
let gm = null;

export const isRunning = () => !!gm;

export function start(name, bytes, onProgress, opts = {}) {
  return new Promise((resolve, reject) => {
    Object.assign(window, {
      EJS_player: '#ejs',
      EJS_core: 'gba',
      EJS_pathtodata: new URL('ejs/data/', location.href).href,
      EJS_gameUrl: new File([bytes], name),
      EJS_gameName: name.replace(/\.[^.]+$/, ''),
      EJS_startOnLoaded: true,
      EJS_skipVersionCheck: true,      // no calls to the EmulatorJS CDN
      EJS_disableDatabases: true,      // MetaMon stores ROMs/saves itself
      EJS_disableLocalStorage: true,
      EJS_threads: false,
      EJS_language: 'en-US',
      EJS_disableAutoLang: false,
      EJS_backgroundColor: '#000',
      EJS_color: '#000000',
      EJS_defaultControls: { 0: {}, 1: {}, 2: {}, 3: {} },
      EJS_defaultOptions: {
        'save-save-interval': '0', virtualGamepad: 'disabled', menubarBehavior: 'downward',
        // performance: the glasses' display may refresh below 60 Hz, so don't tie the
        // emulator to it; let mGBA skip drawing frames when the CPU can't keep up
        vsync: 'disabled',
        webgl2Enabled: 'enabled',
        // the glasses show 30 Hz: emulate all 60 frames but only draw every other one
        mgba_frameskip: 'fixed_interval',
        mgba_frameskip_interval: '1',
        mgba_idle_optimization: 'Remove Known',
        mgba_audio_low_pass_filter: 'disabled',
        mgba_color_correction: 'OFF',
        mgba_interframe_blending: 'OFF',
      },
      // audio: light sinc resampler (nearest crackles), output at 48 kHz like the device, bigger buffer
      EJS_extraRetroarchCfg: 'audio_resampler = "sinc"\naudio_resampler_quality = "1"\naudio_latency = 160\nvideo_vsync = false\naudio_out_rate = 48000\n',
      EJS_onGameStart: () => {
        ejs = window.EJS_emulator; gm = ejs.gameManager;
        clearTimeout(watchdog); clearInterval(poll);
        resolve();
      },
    });
    // Main loop pacing: RetroArch with vsync off spins with setImmediate; a plain timer lets the CPU sleep
    // between frames (our patched core reads EJS_loopTimeoutMs). 0 = original behaviour.
    if (opts.stretch) window.EJS_extraRetroarchCfg += 'aspect_ratio_index = "24"\nvideo_aspect_ratio_auto = "false"\n';
    window.EJS_loopTimeoutMs = LOOP_MS;
    // While waiting for room in the audio buffer RetroArch sleeps 1 ms at a time (Asyncify unwind/rewind
    // each time: ~300 wakeups/s). Sleeping a few ms is plenty with a 160 ms audio buffer.
    window.EJS_minSleepMs = MIN_SLEEP_MS;
    window.EJS_disableGamepadPolling = true;
    // Frames to run per wakeup follow the real clock: normally 2, but when a wakeup comes late
    // (the glasses are busy or throttled) run up to 4 to catch up, so the audio never runs dry.
    // If we're ahead, RetroArch's audio sync just sleeps. Our patched core calls this every wakeup.
    window.EJS_itersPerTick = catchUp();
    // RetroArch redraws the last picture when mGBA skips a frame (30 times a second): our patched core
    // skips those duplicate clear+draw calls, the canvas keeps showing the same image anyway.
    window.EJS_skipDupeDraws = true;
    // WebGL context tuned for a battery device: opaque (no blending with the page), no unused
    // depth/stencil buffers, ask the GPU for low power. Our patched core reads EJS_glAttrs.
    window.EJS_glAttrs = { alpha: false, depth: false, stencil: false, antialias: false, powerPreference: 'low-power' };
    // safe mode (?safe=1): none of our core tweaks, plain EmulatorJS behaviour
    if (new URLSearchParams(location.search).has('safe')) {
      Object.assign(window, { EJS_loopTimeoutMs: 0, EJS_minSleepMs: 0, EJS_itersPerTick: 1, EJS_skipDupeDraws: false, EJS_glAttrs: null, EJS_disableGamepadPolling: false });
    }
    // tuning overrides for testing: localStorage metamon.opts (JSON) / metamon.racfg (text)
    try {
      Object.assign(window.EJS_defaultOptions, JSON.parse(localStorage.getItem('metamon.opts') || '{}'));
      window.EJS_extraRetroarchCfg += localStorage.getItem('metamon.racfg') || '';
      if (localStorage.getItem('metamon.glattrs')) window.EJS_glAttrs = JSON.parse(localStorage.getItem('metamon.glattrs'));
      if (localStorage.getItem('metamon.sleepms') !== null) window.EJS_minSleepMs = Number(localStorage.getItem('metamon.sleepms'));
      if (localStorage.getItem('metamon.iters') !== null) window.EJS_itersPerTick = Number(localStorage.getItem('metamon.iters'));
      if (localStorage.getItem('metamon.dupes') !== null) window.EJS_skipDupeDraws = localStorage.getItem('metamon.dupes') !== '1';
      if (localStorage.getItem('metamon.loopms') !== null) window.EJS_loopTimeoutMs = Number(localStorage.getItem('metamon.loopms'));
    } catch {}
    const s = document.createElement('script');
    s.src = new URL('ejs/data/loader.js', location.href).href;
    s.onerror = () => reject(new Error('Impossibile caricare EmulatorJS'));
    document.body.appendChild(s);
    // surface EmulatorJS's own progress / error text
    // give up only after 60 s without any progress (a slow connection can take longer overall)
    let lastTxt = '', stage = 'caricamento di EmulatorJS', watchdog;
    const arm = () => { clearTimeout(watchdog); watchdog = setTimeout(() => { clearInterval(poll); reject(new Error(`fermo da 60 s a "${stage}"`)); }, 60000); };
    const poll = setInterval(() => {
      const e = window.EJS_emulator;
      if (e && stage === 'caricamento di EmulatorJS') { stage = 'preparazione'; arm(); }
      const txt = (e?.textElem?.innerText || e?.textElem?.textContent || "").trim();
      if (txt && txt !== lastTxt) { lastTxt = stage = txt; onProgress?.(txt); arm(); }
      if (e?.failedToStart) { clearInterval(poll); clearTimeout(watchdog); reject(new Error(txt || 'avvio non riuscito')); }
    }, 300);
    arm();
  });
}

// classic engine: gamma through an SVG filter on the canvas (see index.html)
export function setBrightness(level) { const c = document.querySelector('#ejs canvas'); if (c) c.style.filter = level ? `url(#gamma${level})` : ''; }
export function frameCount() { try { return gm.getFrameNum(); } catch { return 0; } }
export function press(b) { gm?.simulateInput(0, IDX[b], 1); }
export function release(b) { gm?.simulateInput(0, IDX[b], 0); }
export function pause() { try { ejs.pause(true); } catch {} }
export function resume() { try { ejs.play(true); } catch {} }
export function setSpeed(x2) { speedMul = x2 ? 2 : 1; try { gm.setFastForwardRatio(window.EJS_loopTimeoutMs ? 0 : 2); // 0 = no limiter: our clock-based loop sets the pace
  gm.toggleFastForward(x2 ? 1 : 0); } catch (e) { console.warn(e); } }
export function setVolume(v) { try { ejs.setVolume(v); } catch (e) { console.warn(e); } }
export function resumeAudio() {
  try { const ctx = ejs?.Module?.AL?.currentCtx?.audioCtx; if (ctx && ctx.state !== 'running') ctx.resume(); } catch {}
}
export function getState() { return gm.getState().slice(); }
export function loadState(bytes) { gm.loadState(bytes); }
// flush=false just reads the .srm RetroArch already wrote (autosave every 60 s), no extra work
export function getSave(flush = true) { try { return gm.getSaveFile(flush ? undefined : false); } catch { return null; } }
export function restoreSave(bytes) {
  const FS = gm.FS, path = gm.getSaveFilePath();
  let cp = '';
  for (const part of path.split('/').slice(0, -1)) {
    if (!part) continue;
    cp += '/' + part;
    if (!FS.analyzePath(cp).exists) FS.mkdir(cp);
  }
  if (FS.analyzePath(path).exists) FS.unlink(path);
  FS.writeFile(path, bytes);
  gm.loadSaveFiles();
}
