// MetaMon: mGBA (WebAssembly) frontend for Meta Ray-Ban Display glasses.
// Glasses input: ArrowUp/Down/Left/Right + Enter keydown, shell Back -> history.back(),
// optional pinch-and-drag pointer events (body has touch-action: none).
import mGBA from './mgba.js';

const $ = (s) => document.querySelector(s);
const LS = {
  get(k, d) { try { const v = localStorage.getItem('metamon.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('metamon.' + k, JSON.stringify(v)); } catch {} },
};

const settings = {
  stepMs: LS.get('stepMs', 200),   // how long a swipe holds the D-pad (≈ one tile in Pokémon)
  tapMs: 90,                       // A / B / START press length
  run: LS.get('run', false),       // keep B held (running shoes)
  walk: LS.get('walk', false),     // a swipe keeps walking until the next input
  speed: LS.get('speed', false),   // fast forward x2
  audio: LS.get('audio', true),
};

let Module = null;
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
let syncTimer = null;
function syncSoon(ms = 800) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => Module?.FSSync().catch((e) => console.warn(e)), ms);
}

// ---------- cross-origin isolation (needed for mGBA threads) ----------
async function ensureIsolation() {
  if (window.crossOriginIsolated) return true;
  if (!('serviceWorker' in navigator)) return false;
  const reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  if (!sessionStorage.getItem('metamon.reloaded')) {
    sessionStorage.setItem('metamon.reloaded', '1');
    location.reload();
    await new Promise(() => {});
  }
  return false;
}

// ---------- GBA buttons ----------
const timers = new Map();
const held = new Set();
function press(btn) { if (!held.has(btn)) { held.add(btn); Module?.buttonPress(btn); } }
function release(btn) {
  clearTimeout(timers.get(btn)); timers.delete(btn);
  if (held.has(btn)) { held.delete(btn); Module?.buttonUnpress(btn); }
  if (btn === 'b' && settings.run && mode === 'game') press('b'); // keep running
}
function tap(btn, ms = settings.tapMs) {
  press(btn);
  clearTimeout(timers.get(btn));
  timers.set(btn, setTimeout(() => release(btn), ms));
}
function releaseAll() { for (const b of [...held]) { clearTimeout(timers.get(b)); timers.delete(b); held.delete(b); Module?.buttonUnpress(b); } }

const DIRS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
let walking = null;                 // direction held by "Passo continuo"
const keyDownAt = new Map();

function stopWalking() { if (walking) { release(walking); walking = null; } }

function onDirection(dir, repeat) {
  if (settings.walk) {
    if (repeat) return;
    if (walking === dir) { stopWalking(); return; }  // same swipe again = stop
    stopWalking();
    walking = dir; press(dir);
    return;
  }
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
  if (backTimer) {                   // second Back within 350 ms -> menu
    clearTimeout(backTimer); backTimer = null; openMenu(); return;
  }
  backTimer = setTimeout(() => { backTimer = null; stopWalking(); tap('b'); }, 350);
}
window.addEventListener('popstate', () => {
  if (mode === 'loader') return;    // let Back leave the app from the loader
  armBackTrap(); onBack();
});

// ---------- keyboard (glasses D-pad + desktop testing) ----------
const DESKTOP = { KeyX: 'a', KeyZ: 'b', KeyA: 'l', KeyS: 'r', Space: 'start', ShiftRight: 'select', ShiftLeft: 'select' };
window.addEventListener('keydown', (e) => {
  resumeAudio();
  if (mode === 'menu') {
    if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); closeMenu(); }
    return;                          // native spatial navigation handles the menu
  }
  if (mode !== 'game') return;
  e.preventDefault(); e.stopPropagation();
  const dir = DIRS[e.key];
  if (dir) { keyDownAt.set(dir, performance.now()); onDirection(dir, e.repeat); return; }
  if (e.key === 'Enter') { if (!e.repeat) { stopWalking(); tap('a'); } else press('a'); return; }
  if (e.key === 'Escape' || e.key === 'Backspace') { if (!e.repeat) onBack(); return; }
  if (e.key === 'm' || e.key === 'M') { openMenu(); return; }
  const b = DESKTOP[e.code];
  if (b) { if (b === 'b') stopWalking(); press(b); }
}, { capture: true });

window.addEventListener('keyup', (e) => {
  if (mode !== 'game') return;
  e.preventDefault(); e.stopPropagation();
  const dir = DIRS[e.key];
  if (dir && !settings.walk) {
    // If the key was really held (desktop, or a long press), release on keyup,
    // otherwise let the step timer finish so a quick swipe still moves one tile.
    const t = performance.now() - (keyDownAt.get(dir) || 0);
    if (t >= settings.stepMs) release(dir);
    return;
  }
  if (e.key === 'Enter') { if (!timers.has('a')) release('a'); return; }
  const b = DESKTOP[e.code];
  if (b) release(b);
}, { capture: true });

// ---------- pinch-and-drag: hold a direction while dragging ----------
let drag = null;
window.addEventListener('pointerdown', (e) => {
  if (mode !== 'game') return;
  drag = { x: e.clientX, y: e.clientY, dir: null, id: e.pointerId };
  try { e.target.setPointerCapture?.(e.pointerId); } catch {}
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
function endDrag() { if (drag?.dir) release(drag.dir); drag = null; }
window.addEventListener('pointerup', endDrag);
window.addEventListener('pointercancel', endDrag);

// ---------- menu ----------
function refreshMenu() {
  const set = (act, on) => $(`[data-act=${act}]`).setAttribute('aria-pressed', String(on));
  set('run', settings.run); set('walk', settings.walk); set('speed', settings.speed); set('audio', settings.audio);
  const hud = [settings.run && 'Corsa', settings.walk && 'Passo continuo', settings.speed && 'x2', !settings.audio && 'Muto'].filter(Boolean);
  $('#hud').textContent = hud.join(' · ');
}
function openMenu() {
  if (mode !== 'game') return;
  releaseAll(); walking = null;
  mode = 'menu'; Module.pauseGame();
  refreshMenu();
  $('#menu').hidden = false;
  $('#menu [data-act=resume]').focus();
}
function closeMenu(then) {
  if (mode !== 'menu') return;
  $('#menu').hidden = true;
  mode = 'game'; Module.resumeGame();
  $('#game').focus();
  if (settings.run) press('b');
  if (then) setTimeout(then, 60);
}
$('#menu').addEventListener('click', async (e) => {
  const el = e.target.closest('button'); if (!el) return;
  const btn = el.dataset.btn, act = el.dataset.act;
  if (btn) { closeMenu(() => tap(btn, 120)); return; }
  switch (act) {
    case 'resume': closeMenu(); break;
    case 'run': settings.run = !settings.run; LS.set('run', settings.run); refreshMenu(); break;
    case 'walk': settings.walk = !settings.walk; LS.set('walk', settings.walk); refreshMenu(); break;
    case 'speed': settings.speed = !settings.speed; LS.set('speed', settings.speed); applySpeed(); refreshMenu(); break;
    case 'audio': settings.audio = !settings.audio; LS.set('audio', settings.audio); applyAudio(); refreshMenu(); break;
    case 'save': {
      const ok = Module.saveState(1); await Module.FSSync().catch(() => {});
      closeMenu(); toast(ok ? 'Stato salvato' : 'Salvataggio non riuscito'); break;
    }
    case 'load': {
      const ok = Module.loadState(1);
      closeMenu(); toast(ok ? 'Stato caricato' : 'Nessuno stato salvato'); break;
    }
    case 'quit': await quitGame(); break;
  }
});
function applySpeed() { try { Module.setFastForwardMultiplier(settings.speed ? 2 : 1); } catch (e) { console.warn(e); } }
function applyAudio() { try { Module.setVolume(settings.audio ? 100 : 0); } catch (e) { console.warn(e); } }
function resumeAudio() { try { const ctx = Module?.SDL2?.audioContext; if (ctx && ctx.state !== 'running') ctx.resume(); } catch {} }

// ---------- game lifecycle ----------
async function startGame(name) {
  const path = Module.filePaths().gamePath + '/' + name;
  setStatus('Caricamento di ' + name + '…');
  if (!Module.loadGame(path)) { toast('Impossibile avviare ' + name, 3000); setStatus('ROM non valida?'); return; }
  currentRom = name; LS.set('last', name);
  try {
    Module.setCoreSettings({ autoSaveStateEnable: true, restoreAutoSaveStateOnLoad: true, autoSaveStateTimerIntervalSeconds: 30 });
  } catch (e) { console.warn(e); }
  applySpeed(); applyAudio(); resumeAudio();
  $('#loader').hidden = true; $('#game').hidden = false;
  mode = 'game';
  armBackTrap();
  $('#game').focus();
  if (settings.run) press('b');
  refreshMenu();
  toast('Indietro = B · doppio Indietro = menu', 2600);
}
async function quitGame() {
  $('#menu').hidden = true;
  releaseAll();
  try { Module.forceAutoSaveState(); } catch {}
  try { Module.quitGame(); } catch (e) { console.warn(e); }
  await Module.FSSync().catch(() => {});
  mode = 'loader'; currentRom = null;
  $('#game').hidden = true; $('#loader').hidden = false;
  renderLibrary();
}
function persistOnHide() {
  if (!Module || !currentRom) return;
  try { Module.forceAutoSaveState(); } catch {}
  Module.FSSync().catch(() => {});
}
document.addEventListener('visibilitychange', () => { if (document.hidden) persistOnHide(); });
window.addEventListener('pagehide', persistOnHide);

// ---------- library / adding ROMs ----------
function renderLibrary() {
  const roms = Module.listRoms().filter((n) => n !== '.' && n !== '..');
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
  $('#addRom').hidden = false;
  setStatus(roms.length ? 'Scegli un gioco.' : 'Nessuna ROM ancora. Aggiungine una qui sotto.');
  (list.querySelector('button') || $('#btnPhone')).focus();
}
async function addRom(name, bytes) {
  name = safeName(name);
  if (!/\.(gba|gbc|gb|zip|7z)$/i.test(name)) name += '.gba';
  Module.FS.writeFile(Module.filePaths().gamePath + '/' + name, bytes);
  await Module.FSSync().catch((e) => console.warn(e));
  toast('ROM aggiunta: ' + name);
  return name;
}

$('#fileInput').addEventListener('change', async (e) => {
  const f = e.target.files?.[0]; if (!f) return;
  const name = await addRom(f.name, new Uint8Array(await f.arrayBuffer()));
  e.target.value = '';
  startGame(name);
});
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
  $('#phonePanel').hidden = false;
  $('#sendUrl').textContent = new URL('invia.html', location.href).href.replace(/^https?:\/\//, '');
  if (!peer) openPeer();
});
function openPeer() {
  const code = String(Math.floor(1000 + Math.random() * 9000));
  $('#pairCode').textContent = code;
  $('#pairStatus').textContent = 'In attesa del telefono…';
  peer = new window.Peer('metamon-' + code, peerOptions());
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
        peer.destroy(); peer = null; $('#phonePanel').hidden = true;
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
function renderInstallQr() {
  if (window.innerWidth < 760 || !window.qrcode) return;
  const link = `fb-viewapp://web_app_deep_link?appName=MetaMon&appUrl=${encodeURIComponent(location.origin + location.pathname)}`;
  const qr = window.qrcode(0, 'M'); qr.addData(link); qr.make();
  $('#qr').innerHTML = qr.createImgTag(6, 0);
  $('#installPanel').hidden = false;
}

// ---------- boot ----------
(async function boot() {
  try {
    const ok = await ensureIsolation();
    if (!ok && !window.crossOriginIsolated) {
      setStatus('Questo browser non permette i thread WebAssembly (manca il cross-origin isolation): l\'emulatore non può partire.');
      return;
    }
    setStatus('Avvio dell\'emulatore…');
    Module = await mGBA({ canvas: $('#canvas') });
    await Module.FSInit();
    try { Module.toggleInput(false); } catch {}  // we drive the buttons ourselves
    Module.addCoreCallbacks({ saveDataUpdatedCallback: () => syncSoon(), autoSaveStateCapturedCallback: () => syncSoon(2000) });
    window.MetaMon = { Module, settings };   // handy for debugging
    renderInstallQr();
    const romParam = new URLSearchParams(location.search).get('rom');
    if (romParam) {
      const n = safeName(decodeURIComponent(new URL(romParam, location.href).pathname.split('/').pop()));
      if (Module.listRoms().includes(n)) { await startGame(n); return; }
      await fetchRom(romParam); if (mode === 'game') return;
    }
    renderLibrary();
  } catch (err) {
    console.error(err);
    setStatus('Errore di avvio: ' + (err?.message || err));
  }
})();
