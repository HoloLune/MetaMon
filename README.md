# MetaMon

Emulatore Game Boy Advance (mGBA, nella versione single-thread di EmulatorJS) pensato per gli occhiali **Meta Ray-Ban Display**.
Nessuna ROM è inclusa: ognuno carica la propria copia.

## Comandi sugli occhiali

| Gesto | Tasto GBA |
|---|---|
| Swipe su/giù/sinistra/destra | Cammina in quella direzione finché non fai un altro gesto |
| Pinch (Invio) | A (se stai camminando: si ferma e basta) |
| Indietro | B (se stai camminando: si ferma e basta) |
| Indietro due volte di fila | Menu: START, SELECT, L, R, Corri, Camminata auto, Veloce x2, Audio, Salva/Carica stato, Cambia gioco |
| Pinch e trascina | Tiene premuta la direzione finché trascini |

Camminata automatica (attiva di base): uno swipe fa camminare finché non fai pinch, Indietro o lo stesso swipe; uno swipe diverso cambia direzione. Per 1,5 secondi dopo A, B o START gli swipe fanno invece un passo/una voce alla volta, così nei menu e nei dialoghi il cursore non scappa. Se gli occhiali segnalano il dito tenuto appoggiato (tasto ripetuto o rilasciato dopo più di 0,35 s), l'app lo rileva da sola e da lì in poi cammini finché tieni il dito; riattivare «Camminata auto» dal menu annulla il rilevamento. «Prova comandi» nella schermata iniziale mostra gli eventi che arrivano dagli occhiali. Disattivandola dal menu ogni swipe è sempre un passo singolo. *Corri* tiene premuto B (scarpe da corsa).

Da computer: frecce, X = A, Z = B, A = L, S = R, Spazio = START, Shift = SELECT, M o Esc doppio = menu.

## Caricare una ROM

1. **Dal telefono** (consigliato): sugli occhiali scegli «Invia dal telefono», sul telefono apri `<sito>/invia.html`, inserisci il codice di 4 cifre e scegli il file. Il trasferimento è diretto (WebRTC); per l'aggancio usa il server pubblico gratuito di PeerJS (`?peerhost=host:porta` per usarne uno tuo).
2. **Scegli file**, se il browser degli occhiali lo permette.
3. **Da URL**: `<sito>/?rom=https://…/gioco.gba` (il server della ROM deve permettere CORS).

La ROM, i salvataggi in-game (controllati ogni 10 s) e un'istantanea automatica ogni 30 s restano nel browser (Cache Storage, con IndexedDB come riserva), quindi alla riapertura trovi «Continua» esattamente dove eri.

## Pubblicazione

Basta un hosting HTTPS statico (GitHub Pages, Netlify, Vercel, Cloudflare Pages). Il core non usa thread WebAssembly, quindi non servono header speciali: il browser degli occhiali non supporta il cross-origin isolation.

Installazione sugli occhiali: apri il sito dal computer, compare un QR «Installa sugli occhiali» (link `fb-viewapp://web_app_deep_link?...`) da inquadrare con il telefono, con la Modalità sviluppatore attiva nell'app Meta AI.

## Licenze

- EmulatorJS 4.2.3 (`ejs/data`): GPL-3.0, vedi `ejs/LICENSE`. `emulator.min.js` è la semplice concatenazione dei sorgenti in `ejs/data/src` (con il controllo versioni verso il CDN disattivabile).
- Core mGBA per EmulatorJS (`ejs/data/cores`, da `@emulatorjs/core-mgba` 4.2.3): mGBA è MPL-2.0. `mgba-wasm.data` è ricompresso con `mgba_libretro.js` modificato in due punti: legge `window.EJS_glAttrs` (attributi del contesto WebGL a basso consumo) e `window.EJS_loopTimeoutMs` (ritmo del ciclo principale). `GameManager.js` aggiunge `window.EJS_extraRetroarchCfg` alla configurazione di RetroArch.
- PeerJS 1.5.4: MIT · qrcode-generator 1.4.4: MIT
- Il codice di MetaMon è distribuito sotto GPL-3.0 insieme a EmulatorJS.
