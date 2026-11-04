// MetaMon: GBA emulator frontend (mGBA via EmulatorJS) for Meta Ray-Ban Display glasses.
// Glasses input: ArrowUp/Down/Left/Right + Enter keydown, shell Back -> history.back(),
// optional pinch-and-drag pointer events (body has touch-action: none).
import * as engine from './engine.js?v=19';
import * as store from './store.js?v=19';

const $ = (s) => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem('metamon.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('metamon.' + k, JSON.stringify(v)); } catch {} },
};

const settings = {
  stepMs: LS.get('stepMs', 200),   // how long a swipe holds the D-pad (≈ one tile in Pokémon)
  tapMs: 90,                       // A / B / START press length
  run: LS.get('run', false),       // keep B held (running shoes)
  walk: LS.get('walk2', true),     // a swipe keeps walking until the next input (auto, see onDirection)
  menuWindowMs: 1500,              // swipes this soon after a button press are single steps (menus, dialogs)
  speed: LS.get('speed', false),   // fast forward x2
  audio: LS.get('audio', true),
  eco: LS.get('eco', false),       // native-resolution rendering, applied at game start
  screen: LS.get('screen', 'fit'), // fit (3:2, black bands) | zoom (fills the height, crops the sides) | stretch
};

let mode = 'loader';               // 'loader' | 'game' | 'menu'
let currentRom = null;

// ---------- helpers ----------
function toast(msg, ms = 1800) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}
function setStatus(msg) { $('#status').textContent = msg; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const safeName = (n) => (n || 'gioco.gba').split(/[\\/]/).pop().replace(/[^\w.\- ]+/g, '_').slice(0, 80);
const romKeys = async () => (await store.keys()).filter((k) => k.startsWith('rom:')).map((k) => k.slice(4));
function hash(u8) { let h = 2166136261 >>> 0; for (let i = 0; i < u8.length; i += 7) h = Math.imul(h ^ u8[i], 16777619) >>> 0; return h + ':' + u8.length; }

// ---------- GBA buttons ----------
const timers = new Map();
const held = new Set();
function press(btn) { if (!held.has(btn)) { held.add(btn); engine.press(btn); } }
function release(btn) {
  clearTimeout(timers.get(btn)); timers.delete(btn);
  if (held.has(btn)) { held.delete(btn); engine.release(btn); }
  if (btn === 'b' && settings.run && mode === 'game') press('b'); // keep running
}
function tap(btn, ms = settings.tapMs) {
  press(btn);
  clearTimeout(timers.get(btn));
  timers.set(btn, setTimeout(() => release(btn), ms));
}
function releaseAll() { for (const b of [...held]) { clearTimeout(timers.get(b)); timers.delete(b); held.delete(b); engine.release(b); } }

const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
let walking = null;                 // direction held by "Passo continuo"
const keyDownAt = new Map();
const keysDown = new Set();
// Some inputs report "finger still down" (key repeat or a late keyup). Once we see that,
// a direction is held exactly as long as the finger stays down instead of auto-walking.
let holdCapable = LS.get('holdCapable', false);
function learnHold() { if (!holdCapable) { holdCapable = true; LS.set('holdCapable', true); toast('Rilevato: cammini finché tieni il dito'); } }

function stopWalking() { if (walking) { release(walking); walking = null; } }

// Automatic walking: in the overworld a swipe keeps walking until the next input.
// Right after A/B/START (menus, dialogs, battles) swipes are single steps instead,
// so a menu cursor never runs away; each single step keeps that window open.
let lastButtonAt = -Infinity;
const markButton = () => { lastButtonAt = performance.now(); };
function onDirection(dir, repeat) {
  if (repeat) learnHold();
  if (holdCapable) {
    stopWalking();
    for (const d of Object.values(DIRS)) if (d !== dir && held.has(d)) release(d);
    press(dir);
    clearTimeout(timers.get(dir));
    // safety net in case a keyup gets lost
    timers.set(dir, setTimeout(() => { if (!keysDown.has(dir)) release(dir); }, 4000));
    return;
  }
  const inMenuWindow = performance.now() - lastButtonAt < settings.menuWindowMs;
  if (settings.walk && (walking || !inMenuWindow)) {
    if (repeat) return;
    if (walking === dir) { stopWalking(); return; }  // same swipe again = stop
    stopWalking();
    walking = dir; press(dir);
    return;
  }
  if (settings.walk) markButton();
  for (const d of Object.values(DIRS)) if (d !== dir && held.has(d)) release(d);
  tap(dir, settings.stepMs);
}

// ---------- Back button (shell calls history.back()) ----------
// Keep one "trap" entry on top of history; each Back pops it, we put it back.
// The host caps history at 5 entries, we only ever use 2.
let backTimer = null;
function armBackTrap() { if (!history.state?.metamonTrap) history.pushState({ metamonTrap: true }, ''); }
function onBack() {
  if (mode === 'menu') { closeMenu(); return; }
  if (mode !== 'game') return;
  // (a double Back turns the glasses' display off, so it can't open the menu: double pinch does)
  if (walking) { stopWalking(); return; }       // Back while walking = just stop
  markButton(); tap('b');
}
window.addEventListener('popstate', () => {
  if (mode === 'loader') return;    // let Back leave the app from the loader
  if (mode === 'diag') { diag('Indietro (popstate)'); closeDiag(); return; }
  if (mode === 'pair') { closePair(); return; }
  armBackTrap(); onBack();
});

// ---------- keyboard (glasses D-pad + desktop testing) ----------
const DESKTOP = { KeyX: 'a', KeyZ: 'b', KeyA: 'l', KeyS: 'r', Space: 'start', ShiftRight: 'select', ShiftLeft: 'select' };
window.addEventListener('keydown', (e) => {
  resumeAudio();
  if (mode === 'diag') { e.preventDefault(); return; }
  if (mode === 'pair') { if (e.key === 'Escape' || e.key === 'Backspace') closePair(); return; }
  if (mode === 'menu') {
    if (e.repeat && e.key === 'Enter') { e.preventDefault(); return; }   // still holding the long pinch
    if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); closeMenu(); }
    return;                          // native spatial navigation handles the menu
  }
  if (mode !== 'game') return;
  e.preventDefault(); e.stopPropagation();
  const dir = DIRS[e.key];
  if (dir) {
    const again = keysDown.has(dir);           // keydown again without keyup = held
    if (!e.repeat && !again) keyDownAt.set(dir, performance.now());
    keysDown.add(dir);
    onDirection(dir, e.repeat || again);
    return;
  }
  if (e.key === 'Enter') {
    if (e.repeat) { press('a'); return; }
    pinchInGame(); return;
  }
  if (e.key === 'Escape' || e.key === 'Backspace') { if (!e.repeat) onBack(); return; }
  if (e.key === 'm' || e.key === 'M') { openMenu(); return; }
  const b = DESKTOP[e.code];
  if (b) { if (b === 'b') stopWalking(); press(b); }
}, { capture: true });

window.addEventListener('keyup', (e) => {
  if (mode !== 'game') return;
  e.preventDefault(); e.stopPropagation();
  const dir = DIRS[e.key];
  if (dir) {
    keysDown.delete(dir);
    const t = performance.now() - (keyDownAt.get(dir) || 0);
    if (t >= 350) learnHold();
    if (holdCapable) {
      // keep at least one step for a quick swipe, otherwise release on lift
      if (t >= settings.stepMs) release(dir);
      else { clearTimeout(timers.get(dir)); timers.set(dir, setTimeout(() => release(dir), settings.stepMs - t)); }
      return;
    }
    if (!walking && t >= settings.stepMs) release(dir);
    return;
  }
  if (e.key === 'Enter') { if (!timers.has('a')) release('a'); return; }
  const b = DESKTOP[e.code];
  if (b) release(b);
}, { capture: true });

// ---------- pinch / pinch-and-drag (pointer events) ----------
// On the glasses a pinch can arrive as a pointer "tap" somewhere on the page instead of
// an Enter key. A tap that is not on a control would just blur the focused button,
// so we keep focus and activate the focused control ourselves (in game: A button).
let drag = null;
let lastFocused = null;
document.addEventListener('focusin', (e) => { if (e.target !== document.body && e.target.id !== 'game') lastFocused = e.target; });
const onControl = (el) => el?.closest?.('button, a, input, label, select, textarea');
// keep the focused control focused when the tap lands elsewhere
// Glasses = no precise hovering pointer (?glasses=1 forces it for testing on a computer).
const isGlasses = new URLSearchParams(location.search).has('glasses') || !matchMedia('(hover: hover) and (pointer: fine)').matches;
window.addEventListener('mousedown', (e) => { if (isGlasses || !onControl(e.target)) e.preventDefault(); }, { capture: true });
window.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY, t: performance.now(), dir: null, id: e.pointerId, target: e.target };
  if (mode === 'game') { try { e.target.setPointerCapture?.(e.pointerId); } catch {} }
});
window.addEventListener('pointermove', (e) => {
  if (!drag || mode !== 'game' || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (Math.hypot(dx, dy) < 24) return;
  const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  if (dir !== drag.dir) {
    if (drag.dir) release(drag.dir);
    stopWalking();
    drag.dir = dir; press(dir);
  }
});
let lastEnterAt = -Infinity;
window.addEventListener('keydown', (e) => { if (e.key === 'Enter') lastEnterAt = performance.now(); }, { capture: true });
function endDrag(e) {
  const d = drag; drag = null;
  if (!d) return;
  if (d.dir) { release(d.dir); return; }
  if (e.type !== 'pointerup') return;
  const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
  if (moved > 24 || performance.now() - d.t > 800) return;
  // it was a tap / pinch (skip if the same pinch also produced an Enter key)
  if (performance.now() - lastEnterAt < 400) return;
  if (mode === 'game') { lastTapAt = performance.now(); pinchInGame(); }
}
let lastTapAt = -Infinity;
// pinch = A. Menu (START, SELECT, L, R, saves…) = long pinch (held 0.6 s) only: quick pinches
// happen all the time when skipping dialogue.
function pinchInGame() {
  resumeAudio();
  if (walking) { stopWalking(); return; }
  markButton(); tap('a');
}
// long pinch: whatever "finger down" signal the glasses send (Enter keydown, mouse/pointer down)
let longTimer = 0, longOpened = false;
function holdStart() {
  if (mode !== 'game' || longTimer) return;
  longTimer = setTimeout(() => { longTimer = 0; if (mode !== 'game' || drag?.dir) return; longOpened = true; release('a'); openMenu(); }, 600);
}
function holdEnd() { clearTimeout(longTimer); longTimer = 0; if (longOpened) setTimeout(() => { longOpened = false; }, 400); }
window.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.repeat) holdStart(); }, { capture: true });
window.addEventListener('keyup', (e) => { if (e.key === 'Enter') holdEnd(); }, { capture: true });
window.addEventListener('mousedown', holdStart, { capture: true });
window.addEventListener('mouseup', holdEnd, { capture: true });
window.addEventListener('pointerdown', holdStart, { capture: true });
window.addEventListener('pointerup', holdEnd, { capture: true });
window.addEventListener('pointercancel', holdEnd, { capture: true });
// The glasses turn a pinch into a mouse click at the centre of the screen (300,300),
// whatever is under it. Redirect such stray clicks to the control that has the focus ring.
window.addEventListener('click', (e) => {
  if (!e.isTrusted) return;
  if (mode === 'game') {
    // a pinch that only produced a click (no pointer tap, no Enter) still means A
    const now = performance.now();
    if (now - lastTapAt > 400 && now - lastEnterAt > 400) pinchInGame();
    e.preventDefault(); e.stopImmediatePropagation(); return;
  }
  if (!isGlasses) return;
  const el = document.activeElement;
  if (!el || el === document.body || el.contains(e.target)) return;   // normal click on the focused control
  // the end of the long pinch / the last quick pinch that opened the menu must not press a menu button
  if (mode === 'menu' && (longOpened || performance.now() - menuOpenedAt < 500)) { longOpened = false; e.preventDefault(); e.stopImmediatePropagation(); return; }
  if (e.target.closest?.('#fileInput')) return;
  e.preventDefault(); e.stopImmediatePropagation();
  if (performance.now() - lastEnterAt < 400) return;   // the Enter key already activated it
  if (el.matches('button, a, input[type=submit]')) el.click();
}, { capture: true });
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// ---------- input test screen ----------
const diagLog = [];
function diag(msg) {
  if (mode !== 'diag') return;
  diagLog.unshift(`${(performance.now() / 1000).toFixed(2)}s  ${msg}`); diagLog.length = Math.min(diagLog.length, 9);
  $('#diagLog').textContent = diagLog.join('\n');
  $('#diagMode').textContent = holdCapable ? 'Modalità: cammini finché tieni il dito' : 'Modalità: camminata automatica (nessun «dito tenuto» rilevato finora)';
}
const diagDown = new Map();
for (const t of ['keydown', 'keyup']) window.addEventListener(t, (e) => {
  if (mode !== 'diag') return;
  let extra = e.repeat ? ' (repeat)' : '';
  if (t === 'keydown' && !e.repeat) diagDown.set(e.key, performance.now());
  if (t === 'keyup' && diagDown.has(e.key)) {
    const ms = Math.round(performance.now() - diagDown.get(e.key)); extra = ` dopo ${ms} ms`;
    if (DIRS[e.key] && ms >= 350) learnHold();
  }
  if (e.repeat && DIRS[e.key]) learnHold();
  diag(`${t} ${e.key}${extra}`);
}, { capture: true });
for (const t of ['pointerdown', 'pointerup', 'pointercancel']) window.addEventListener(t, (e) => diag(`${t} ${Math.round(e.clientX)},${Math.round(e.clientY)}`));
$('#btnDiag').addEventListener('click', () => {
  mode = 'diag'; diagLog.length = 0; armBackTrap();
  $('#loader').hidden = true; $('#diag').hidden = false; document.activeElement?.blur();
  diag('Fai swipe, tieni il dito, pinch… Indietro per uscire');
});
function closeDiag() { $('#diag').hidden = true; $('#loader').hidden = false; mode = 'loader'; renderLibrary(); }

// ---------- menu ----------
const SCREEN_LABEL = { fit: 'normale', zoom: 'zoom', stretch: 'pieno' };
function refreshMenu() {
  const set = (act, on) => $(`[data-act=${act}]`).setAttribute('aria-pressed', String(on));
  set('run', settings.run); set('walk', settings.walk); set('speed', settings.speed); set('audio', settings.audio); set('eco', settings.eco);
  $('[data-act=screen]').textContent = 'Schermo: ' + SCREEN_LABEL[settings.screen];
  const hud = [settings.run && 'Corsa', !settings.walk && 'Passi singoli', settings.speed && 'x2', !settings.audio && 'Muto', settings.eco && 'Eco'].filter(Boolean);
  if (perfText && LS.get('perf', true)) hud.push(perfText);
  $('#hud').textContent = hud.join(' · ');
}
let menuOpenedAt = 0;
function openMenu() {
  if (mode !== 'game') return;
  menuOpenedAt = performance.now();
  releaseAll(); walking = null;
  mode = 'menu'; engine.pause();
  refreshMenu();
  $('#menu').hidden = false;
  $('#menu [data-act=resume]').focus();
}
function closeMenu(then) {
  if (mode !== 'menu') return;
  $('#menu').hidden = true; $('#backup').hidden = true;
  mode = 'game'; engine.resume();
  $('#game').focus();
  if (settings.run) press('b');
  if (then) setTimeout(then, 60);
}
$('#menu').addEventListener('click', async (e) => {
  const el = e.target.closest('button'); if (!el) return;
  const btn = el.dataset.btn, act = el.dataset.act;
  if (btn) { markButton(); closeMenu(() => tap(btn, 120)); return; }
  switch (act) {
    case 'resume': closeMenu(); break;
    case 'run': settings.run = !settings.run; LS.set('run', settings.run); refreshMenu(); break;
    case 'walk': settings.walk = !settings.walk; LS.set('walk2', settings.walk); if (settings.walk) { holdCapable = false; LS.set('holdCapable', false); } refreshMenu(); break;
    case 'speed': settings.speed = !settings.speed; LS.set('speed', settings.speed); applySpeed(); refreshMenu(); break;
    case 'audio': settings.audio = !settings.audio; LS.set('audio', settings.audio); set('eco', settings.eco); applyAudio(); refreshMenu(); break;
    case 'save': {
      let ok = false;
      try { await store.put(`state:${currentRom}:1`, engine.getState()); ok = true; } catch (err) { console.warn(err); }
      closeMenu(); toast(ok ? 'Stato salvato' : 'Salvataggio non riuscito'); break;
    }
    case 'load': {
      const st = await store.get(`state:${currentRom}:1`);
      if (st) engine.loadState(st);
      closeMenu(); toast(st ? 'Stato caricato' : 'Nessuno stato salvato'); break;
    }
    case 'screen': {
      settings.screen = { fit: 'zoom', zoom: 'stretch', stretch: 'fit' }[settings.screen] || 'fit'; LS.set('screen', settings.screen);
      $('#menu').hidden = true; toast('Schermo ' + SCREEN_LABEL[settings.screen] + ', riavvio…');
      await persist(true);
      location.href = location.pathname + '?play=' + encodeURIComponent(currentRom);
      break;
    }
    case 'eco': {
      settings.eco = !settings.eco; LS.set('eco', settings.eco);
      $('#menu').hidden = true; toast('Riavvio il gioco…');
      await persist(true);
      location.href = location.pathname + '?play=' + encodeURIComponent(currentRom);
      break;
    }
    case 'quit': await quitGame(); break;
    case 'backup': await openBackups(); break;
  }
});
function applySpeed() { engine.setSpeed(settings.speed); }
function applyAudio() { engine.setVolume(settings.audio ? 1 : 0); }
function resumeAudio() { engine.resumeAudio(); }

// ---------- game lifecycle ----------
async function startGame(name) {
  // EmulatorJS runs one game per page: switching game = reload with ?play=
  if (engine.isRunning() || startGame.busy) { location.href = location.pathname + '?play=' + encodeURIComponent(name); return; }
  startGame.busy = true;
  setStatus('Caricamento di ' + name + '…');
  $('#addRom').hidden = true; $('#library').hidden = true; $('#tools').hidden = true;
  const bytes = await store.get('rom:' + name);
  if (!bytes) { setStatus('ROM non trovata: ' + name); startGame.busy = false; renderLibrary(); return; }
  LS.set('last', name);
  document.body.classList.toggle('eco', settings.eco);
  document.body.dataset.screen = settings.eco ? 'fit' : settings.screen;
  const k = Math.min(innerWidth / 240, innerHeight / 160);
  document.documentElement.style.setProperty('--gba-scale', String(k));
  $('#game').hidden = false; $('#game').style.visibility = 'hidden';
  try {
    await engine.start(name, bytes, (txt) => setStatus(txt), { stretch: !settings.eco && settings.screen === 'stretch' });
  } catch (err) {
    console.error(err);
    $('#game').hidden = true; $('#game').style.visibility = '';
    setStatus('Impossibile avviare ' + name + ': ' + err.message);
    startGame.busy = false;
    // offer a retry without MetaMon's emulator tweaks, to tell a tweak problem from a device/network one
    const safe = new URLSearchParams(location.search).has('safe');
    const retry = document.createElement('button');
    retry.type = 'button'; retry.className = 'retry';
    retry.textContent = safe ? 'Riprova' : 'Riprova in modalità sicura';
    retry.addEventListener('click', () => { location.href = location.pathname + '?play=' + encodeURIComponent(name) + '&safe=1'; });
    $('#status').after(retry);
    retry.focus();
    return;
  }
  currentRom = name;
  // restore in-game save (SRAM) and the automatic snapshot of where you left off
  await restoreProgress(name);
  applySpeed(); applyAudio(); resumeAudio();
  $('#loader').hidden = true; $('#game').style.visibility = '';
  mode = 'game'; document.body.classList.add('playing');
  armBackTrap();
  $('#game').focus();
  if (settings.run) press('b');
  refreshMenu();
  toast('Pinch = A · Indietro = B · pinch lungo = menu', 3000);
  startPerfMeter();
  setInterval(() => persist(false), 10000);
  setInterval(() => persist(true), 30000);
}
// speed meter in the HUD: display refresh rate vs emulated frames per second (GBA = 60)
let perfText = '';
function startPerfMeter() {
  // measure the display refresh only for the first seconds (a permanent rAF loop costs power)
  let raf = 0, hz = null;
  const t0 = performance.now();
  const tick = () => { raf++; if (performance.now() - t0 < 4000) requestAnimationFrame(tick); else hz = Math.round(raf / ((performance.now() - t0) / 1000)); };
  requestAnimationFrame(tick);
  let f0 = engine.frameCount(), tf = performance.now();
  setInterval(() => {
    if (document.hidden) return;
    const t = performance.now(), f = engine.frameCount();
    perfText = (hz ? `schermo ${hz} Hz · ` : '') + `gioco ${Math.round((f - f0) / ((t - tf) / 1000))} fps`;
    f0 = f; tf = t;
    if (LS.get('perf', true)) refreshMenu();
  }, 3000);
}
let lastSrm = null;
async function persist(withState) {
  if (!currentRom) return;
  try {
    const srm = engine.getSave(withState);
    if (srm && srm.length && !srmLocked) {
      const h = hash(srm);
      // never replace a real save with an empty one (e.g. the core didn't take our save at startup)
      if (h !== lastSrm && !(isBlank(srm) && hadRealSrm)) {
        await backupSrm(currentRom);
        await store.put('srm:' + currentRom, srm.slice()); lastSrm = h;
        if (!isBlank(srm)) hadRealSrm = true;
      }
    }
  } catch (e) { console.warn('save', e); }
  if (withState && (mode === 'game' || mode === 'menu')) {
    try { await store.put(`state:${currentRom}:auto`, engine.getState()); } catch (e) { console.warn('state', e); }
  }
}
// ---------- restoring and protecting progress ----------
let srmLocked = false, hadRealSrm = false;
const isBlank = (u8) => { const v = u8[0]; if (v !== 0 && v !== 0xff) return false; for (let i = 0; i < u8.length; i++) if (u8[i] !== v) return false; return true; };
async function waitFrames(n, ms) {
  const f0 = engine.frameCount(), t0 = performance.now();
  while (engine.frameCount() - f0 < n && performance.now() - t0 < ms) await sleep(50);
}
async function restoreProgress(name) {
  // On a slow device the emulator reports "started" before RetroArch has finished loading the game;
  // a save restored too early gets replaced by an empty one. Wait until frames are really running.
  await waitFrames(20, 15000);
  const srm = await store.get('srm:' + name);
  if (srm) {
    hadRealSrm = !isBlank(srm);
    let ok = false;
    for (let i = 0; i < 4 && !ok; i++) {
      try { engine.restoreSave(srm); } catch (e) { console.warn(e); }
      await waitFrames(3, 2000);
      const now = engine.getSave(true);
      ok = !!now && hash(now) === hash(srm);
      if (!ok) await sleep(500);
    }
    if (ok) lastSrm = hash(srm);
    else { srmLocked = true; toast('Salvataggio non caricato: non lo sovrascrivo. Riavvia il gioco.', 6000); }
  }
  const st = await store.get(`state:${name}:auto`);
  if (st) {
    // keep where you were when you opened the game, in case this session goes wrong
    try { await store.put(`state:${name}:open`, st); } catch {}
    try { engine.loadState(st); } catch (e) { console.warn(e); }
  }
}
// rolling backups of the in-game save: at most one every 10 minutes, last 6 kept
async function backupSrm(name) {
  const tsKey = 'bakAt:' + name;
  if (Date.now() - (LS.get(tsKey, 0)) < 10 * 60 * 1000) return;
  const cur = await store.get('srm:' + name);
  if (!cur || isBlank(cur)) return;
  await store.put(`bak:${name}:${Date.now()}`, cur);
  LS.set(tsKey, Date.now());
  const old = (await listBackups(name)).slice(6);
  for (const b of old) await store.del(b.key);
}
async function listBackups(name) {
  const pre = `bak:${name}:`;
  return (await store.keys()).filter((k) => k.startsWith(pre)).map((k) => ({ key: k, t: Number(k.slice(pre.length)) })).sort((a, b) => b.t - a.t);
}
async function openBackups() {
  const list = $('#bakList'); list.textContent = '';
  const fmt = (t) => new Date(t).toLocaleString('it-IT', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
  const add = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); list.appendChild(b); };
  add('Indietro', () => { $('#backup').hidden = true; $('#menu').hidden = false; $('#menu [data-act=backup]').focus(); });
  if (await store.get(`state:${currentRom}:open`)) add('Torna a quando hai aperto il gioco', async () => {
    const st = await store.get(`state:${currentRom}:open`); engine.loadState(st); $('#backup').hidden = true; closeMenu(); toast('Ripristinato');
  });
  for (const b of await listBackups(currentRom)) add('Salvataggio del ' + fmt(b.t), async () => {
    const name = currentRom, bytes = await store.get(b.key);
    currentRom = null;   // stop autosave from writing the current save/state back while we reload
    await store.put('srm:' + name, bytes);
    const st = await store.get(`state:${name}:auto`);
    if (st) { await store.put(`state:${name}:beforeRestore`, st); await store.del(`state:${name}:auto`); }
    toast('Ripristino, riavvio il gioco…');
    location.href = location.pathname + '?play=' + encodeURIComponent(name);
  });
  $('#menu').hidden = true; $('#backup').hidden = false;
  (list.children[1] || list.children[0]).focus();
}

async function quitGame() {
  $('#menu').hidden = true;
  releaseAll();
  await persist(true);
  location.href = location.pathname;
}
// stop emulating while the display is off or the app is in the background (saves battery and heat)
document.addEventListener('visibilitychange', () => {
  if (!currentRom) return;
  if (document.hidden) { persist(true); engine.pause(); }
  else if (mode === 'game') { engine.resume(); resumeAudio(); }
});
window.addEventListener('pagehide', () => persist(true));

// ---------- library / adding ROMs ----------
async function renderLibrary() {
  const roms = await romKeys();
  const list = $('#romList'); list.innerHTML = '';
  const last = LS.get('last', null);
  roms.sort((a, b) => (a === last ? -1 : b === last ? 1 : a.localeCompare(b)));
  for (const n of roms) {
    const b = document.createElement('button'); b.type = 'button';
    b.textContent = (n === last ? 'Continua: ' : '') + n.replace(/\.(gba|gbc|gb|zip|7z)$/i, '');
    b.addEventListener('click', () => startGame(n));
    list.appendChild(b);
  }
  $('#library').hidden = roms.length === 0;
  $('#addRom').hidden = false; $('#tools').hidden = false;
  setStatus(roms.length ? 'Scegli un gioco.' : 'Nessuna ROM ancora. Aggiungine una qui sotto.');
  (list.querySelector('button') || $('#btnPhone')).focus();
}
async function addRom(name, bytes) {
  name = safeName(name);
  if (!/\.(gba|gbc|gb|zip|7z)$/i.test(name)) name += '.gba';
  await store.put('rom:' + name, bytes);
  toast('ROM aggiunta: ' + name);
  return name;
}

$('#fileInput').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  const name = await addRom(f.name, new Uint8Array(await f.arrayBuffer()));
  e.target.value = '';
  startGame(name);
});
$('#btnFile').addEventListener('click', () => $('#fileInput').click());
$('#btnUrl').addEventListener('click', () => { $('#urlForm').hidden = false; $('#urlInput').focus(); });
$('#urlForm').addEventListener('submit', (e) => { e.preventDefault(); fetchRom($('#urlInput').value.trim()); });
async function fetchRom(url) {
  if (!url) return;
  try {
    setStatus('Scarico la ROM…');
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const name = await addRom(decodeURIComponent(new URL(url, location.href).pathname.split('/').pop()) || 'gioco.gba', bytes);
    startGame(name);
  } catch (err) {
    console.warn(err);
    setStatus('Download non riuscito (il server deve permettere CORS). ' + err.message);
  }
}

// Phone -> glasses transfer over WebRTC (PeerJS public broker for signaling).
let peer = null;
// ?peerhost=host:port lets you use your own PeerJS server instead of the public one (also used for tests).
function peerOptions() {
  const h = new URLSearchParams(location.search).get('peerhost');
  if (!h) return {};
  const [host, port] = h.split(':');
  return { host, port: Number(port || 443), path: '/', secure: location.protocol === 'https:' && host !== 'localhost' };
}
$('#btnPhone').addEventListener('click', () => {
  window.__evlog?.('apro schermata codice');
  mode = 'pair'; armBackTrap();
  $('#loader').hidden = true; $('#pair').hidden = false; document.activeElement?.blur();
  $('#sendUrl').textContent = new URL('invia.html', location.href).href.replace(/^https?:\/\//, '');
  if (!peer) openPeer();
});
function closePair() {
  try { peer?.destroy(); } catch {}
  peer = null;
  $('#pair').hidden = true; $('#loader').hidden = false; mode = 'loader'; renderLibrary();
}
// libraries loaded only when needed (less to parse and keep in memory during play)
const loadScript = (src) => new Promise((res, rej) => { const el = document.createElement('script'); el.src = src; el.onload = res; el.onerror = () => rej(new Error('impossibile caricare ' + src)); document.head.appendChild(el); });
async function openPeer() {
  if (!window.Peer) { $('#pairStatus').textContent = 'Mi collego…'; try { await loadScript('vendor/peerjs.min.js'); } catch {} }
  if (mode !== 'pair' || peer) return;
  const code = String(Math.floor(1000 + Math.random() * 9000));
  $('#pairCode').textContent = code;
  $('#pairStatus').textContent = 'Mi collego…';
  if (!window.Peer) { $('#pairStatus').textContent = 'Errore: libreria di collegamento non caricata. Riapri l\'app.'; return; }
  try { peer = new window.Peer('metamon-' + code, peerOptions()); }
  catch (err) { $('#pairStatus').textContent = 'Errore: ' + err.message; return; }
  peer.on('open', () => { $('#pairStatus').textContent = 'Pronto, in attesa del telefono…'; });
  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') { peer.destroy(); peer = null; openPeer(); return; }
    $('#pairStatus').textContent = 'Errore di connessione: ' + err.type;
  });
  peer.on('connection', (conn) => {
    let meta = null, parts = [], got = 0;
    conn.on('data', async (d) => {
      if (d && d.type === 'meta') { meta = d; parts = []; got = 0; $('#pairStatus').textContent = 'Ricevo ' + d.name + '…'; return; }
      if (d && d.type === 'done' && meta) {
        const bytes = new Uint8Array(got); let o = 0;
        for (const p of parts) { bytes.set(p, o); o += p.length; }
        parts = [];
        conn.send({ type: 'ok' });
        const name = await addRom(meta.name, bytes);
        peer.destroy(); peer = null; $('#pair').hidden = true; $('#loader').hidden = false; mode = 'loader';
        startGame(name);
        return;
      }
      const chunk = d instanceof ArrayBuffer ? new Uint8Array(d) : d instanceof Uint8Array ? d : null;
      if (chunk && meta) {
        parts.push(chunk); got += chunk.length;
        $('#pairStatus').textContent = `Ricevo ${meta.name}: ${Math.round((got / meta.size) * 100)}%`;
      }
    });
  });
}

// Install QR (shown on a large screen, e.g. the computer, not on the glasses).
async function renderInstallQr() {
  if (window.innerWidth < 760) return;
  if (!window.qrcode) { try { await loadScript('vendor/qrcode.js'); } catch { return; } }
  const link = `fb-viewapp://web_app_deep_link?appName=MetaMon&appUrl=${encodeURIComponent(location.origin + location.pathname)}`;
  const qr = window.qrcode(0, 'M'); qr.addData(link); qr.make();
  $('#qr').innerHTML = qr.createImgTag(6, 0);
  $('#installPanel').hidden = false;
}

// ---------- boot ----------
(async function boot() {
  try {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    window.MetaMon = { engine, store, settings, held };   // handy for debugging
    renderInstallQr();
    const q = new URLSearchParams(location.search);
    const play = q.get('play');
    if (play && (await romKeys()).includes(play)) { await startGame(play); return; }
    const romParam = q.get('rom');
    if (romParam) {
      const n = safeName(decodeURIComponent(new URL(romParam, location.href).pathname.split('/').pop()));
      if ((await romKeys()).includes(n)) { await startGame(n); return; }
      await fetchRom(romParam); if (mode === 'game') return;
    }
    await renderLibrary();
  } catch (err) {
    console.error(err);
    setStatus('Errore di avvio: ' + (err?.message || err));
  }
})();
