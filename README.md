# MetaMon

Emulatore Game Boy Advance (mGBA, nella versione single-thread di EmulatorJS) pensato per gli occhiali **Meta Ray-Ban Display**.
Nessuna ROM è inclusa: ognuno carica la propria copia.

## Comandi sugli occhiali

| Gesto | Tasto GBA |
|---|---|
| Swipe su/giù/sinistra/destra | Cammina in quella direzione finché non fai un altro gesto |
| Pinch | A (se stai camminando: si ferma e basta) |
| Indietro | B (se stai camminando: si ferma e basta) |
| Pinch lungo (tieni chiuse le dita 0,6 s) | Menu: Riprendi, START, SELECT, L, R, Corri, Salva/Carica stato, Cambia gioco e **Impostazioni**: Camminata auto, x2 camminando, Audio, Schermo (normale, zoom, pieno), Luminosità (schiarisce le zone scure, utile sul display additivo), Eco, Motore (classico/nuovo), Backup. Indietro torna alla pagina precedente |
| Pinch e trascina | Tiene premuta la direzione finché trascini |

Camminata automatica (attiva di base): uno swipe fa camminare finché non fai pinch, Indietro o lo stesso swipe; uno swipe diverso cambia direzione. Dopo A, B, START o dopo esserti fermato con pinch/Indietro la camminata automatica si spegne: gli swipe fanno un passo/una voce alla volta, così nei dialoghi e nei menu il cursore non scappa. Due swipe veloci nella stessa direzione la riaccendono e ripartono a camminare. Se gli occhiali segnalano il dito tenuto appoggiato (tasto ripetuto o rilasciato dopo più di 0,35 s), l'app lo rileva da sola e da lì in poi cammini finché tieni il dito; riattivare «Camminata auto» dal menu annulla il rilevamento. «Prova comandi» nella schermata iniziale mostra gli eventi che arrivano dagli occhiali. Disattivandola dal menu ogni swipe è sempre un passo singolo. *Corri* tiene premuto B (scarpe da corsa).

Da computer: frecce, X = A, Z = B, A = L, S = R, Spazio = START, Shift = SELECT, M = menu. (Il doppio Indietro sugli occhiali spegne il display e due pinch veloci servono a scorrere i dialoghi, per questo il menu è sul pinch lungo.)

## Caricare una ROM

1. **Dal telefono** (consigliato): sugli occhiali scegli «Invia dal telefono», sul telefono apri `<sito>/invia.html`, inserisci il codice di 4 cifre e scegli il file. Il trasferimento è diretto (WebRTC); per l'aggancio usa il server pubblico gratuito di PeerJS (`?peerhost=host:porta` per usarne uno tuo).
2. **Scegli file**, se il browser degli occhiali lo permette.
3. **Da URL**: `<sito>/?rom=https://…/gioco.gba` (il server della ROM deve permettere CORS).

La ROM, i salvataggi in-game (controllati ogni 10 s) e un'istantanea automatica ogni 30 s restano nel browser (Cache Storage, con IndexedDB come riserva), quindi alla riapertura trovi «Continua» esattamente dove eri.

## Pubblicazione

Basta un hosting HTTPS statico (GitHub Pages, Netlify, Vercel, Cloudflare Pages). Il core non usa thread WebAssembly, quindi non servono header speciali: il browser degli occhiali non supporta il cross-origin isolation.

Installazione sugli occhiali: apri il sito dal computer, compare un QR «Installa sugli occhiali» (link `fb-viewapp://web_app_deep_link?...`) da inquadrare con il telefono, con la Modalità sviluppatore attiva nell'app Meta AI.

## Licenze

- EmulatorJS 4.2.3 (`ejs/data`): GPL-3.0, vedi `ejs/LICENSE`. `emulator.min.js` è generato dai sorgenti in `ejs/data/src` (controllo versioni verso il CDN disattivabile).
- Core mGBA per EmulatorJS (`ejs/data/cores`, da `@emulatorjs/core-mgba` 4.2.3): mGBA è MPL-2.0. `mgba-wasm.data` è ricompresso con `mgba_libretro.js` modificato: legge `window.EJS_glAttrs` (attributi del contesto WebGL a basso consumo), `window.EJS_loopTimeoutMs` (ciclo principale a timer, un risveglio per fotogramma invece di uno spin con setImmediate) e `window.EJS_minSleepMs` (attesa minima quando il buffer audio è pieno, invece di 1 ms); lo scheduler audio OpenAL gira ogni 50 ms con 150 ms di anticipo. Con `window.EJS_itersPerTick` esegue più fotogrammi per risveglio, e con `window.EJS_skipDupeDraws` salta clear e draw quando RetroArch ridisegna un fotogramma saltato identico al precedente. In `gamepad.js` il polling dei gamepad si disattiva con `window.EJS_disableGamepadPolling`. `emulator.min.js` si rigenera con `tools/build-ejs.sh` (senza socket.io, che serve solo al netplay). `GameManager.js` aggiunge `window.EJS_extraRetroarchCfg` alla configurazione di RetroArch.
- PeerJS 1.5.4: MIT · qrcode-generator 1.4.4: MIT
- Il codice di MetaMon è distribuito sotto GPL-3.0 insieme a EmulatorJS.

## Motore nuovo (sperimentale)

Dal menu, *Motore* passa dal motore classico (EmulatorJS + RetroArch) a quello nuovo: il core mGBA di [libretro/mgba](https://github.com/libretro/mgba) (commit 7a12d6d, MPL-2.0) compilato da noi con Emscripten senza RetroArch, Asyncify né thread, più un piccolo frontend (`core-src/front.c`, `engine2.js`): un timer a 30 Hz esegue 2 fotogrammi, l'immagine va in WebGL e l'audio in un unico flusso AudioWorklet. Nei test usa circa il 40% di CPU in meno. Lo schermo cambia senza riavviare. I salvataggi in-game (.srm) valgono per entrambi i motori; gli stati salvati del motore nuovo non si caricano in quello classico (mGBA più vecchio). Ricompilare: `tools/build-core.sh /percorso/mgba` con emsdk attivo.

## Salvataggi sul telefono

Sugli occhiali «Telefono: ROM e salvataggi» mostra un codice; sul telefono apri `invia.html`, scrivi il codice e premi *Collega*. Da lì puoi inviare una ROM, **scaricare il salvataggio** di ogni gioco (file `.sav`, lo stesso formato di mGBA e degli altri emulatori) oppure **caricarne uno** sugli occhiali: quello vecchio finisce tra i backup e il gioco riparte dal salvataggio caricato.
