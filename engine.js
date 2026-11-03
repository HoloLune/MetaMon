// GBA engine: mGBA libretro core packaged by EmulatorJS (single-threaded WebAssembly,
// so it runs without cross-origin isolation / SharedArrayBuffer).
// EmulatorJS's own UI and keyboard handling are disabled; MetaMon drives it.
const IDX = { b: 0, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7, a: 8, l: 10, r: 11 };

let ejs = null;
let gm = null;

export const isRunning = () => !!gm;

export function start(name, bytes, onProgress) {
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
      EJS_defaultOptions: { 'save-save-interval': '0', virtualGamepad: 'disabled', menubarBehavior: 'downward' },
      EJS_onGameStart: () => {
        ejs = window.EJS_emulator; gm = ejs.gameManager;
        clearTimeout(watchdog); clearInterval(poll);
        resolve();
      },
    });
    const s = document.createElement('script');
    s.src = new URL('ejs/data/loader.js', location.href).href;
    s.onerror = () => reject(new Error('Impossibile caricare EmulatorJS'));
    document.body.appendChild(s);
    // surface EmulatorJS's own progress / error text
    const poll = setInterval(() => {
      const e = window.EJS_emulator;
      const txt = e?.textElem?.innerText;
      if (txt) onProgress?.(txt);
      if (e?.failedToStart) { clearInterval(poll); clearTimeout(watchdog); reject(new Error(txt || 'avvio non riuscito')); }
    }, 300);
    const watchdog = setTimeout(() => { clearInterval(poll); reject(new Error('timeout (60 s)')); }, 60000);
  });
}

export function press(b) { gm?.simulateInput(0, IDX[b], 1); }
export function release(b) { gm?.simulateInput(0, IDX[b], 0); }
export function pause() { try { ejs.pause(true); } catch {} }
export function resume() { try { ejs.play(true); } catch {} }
export function setSpeed(x2) { try { gm.setFastForwardRatio(2); gm.toggleFastForward(x2 ? 1 : 0); } catch (e) { console.warn(e); } }
export function setVolume(v) { try { ejs.setVolume(v); } catch (e) { console.warn(e); } }
export function resumeAudio() {
  try { const ctx = ejs?.Module?.AL?.currentCtx?.audioCtx; if (ctx && ctx.state !== 'running') ctx.resume(); } catch {}
}
export function getState() { return gm.getState().slice(); }
export function loadState(bytes) { gm.loadState(bytes); }
export function getSave() { try { return gm.getSaveFile(); } catch { return null; } }
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
