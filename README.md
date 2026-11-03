# MetaMon

Emulatore Game Boy Advance (mGBA in WebAssembly) pensato per gli occhiali **Meta Ray-Ban Display**.
Nessuna ROM è inclusa: ognuno carica la propria copia.

## Comandi sugli occhiali

| Gesto | Tasto GBA |
|---|---|
| Swipe su/giù/sinistra/destra | Cammina in quella direzione finché non fai un altro gesto |
| Pinch (Invio) | A (se stai camminando: si ferma e basta) |
| Indietro | B (se stai camminando: si ferma e basta) |
| Indietro due volte di fila | Menu: START, SELECT, L, R, Corri, Camminata auto, Veloce x2, Audio, Salva/Carica stato, Cambia gioco |
| Pinch e trascina | Tiene premuta la direzione finché trascini |

Camminata automatica (attiva di base): uno swipe fa camminare finché non fai pinch, Indietro o lo stesso swipe; uno swipe diverso cambia direzione. Per 1,5 secondi dopo A, B o START gli swipe fanno invece un passo/una voce alla volta, così nei menu e nei dialoghi il cursore non scappa. Disattivandola dal menu ogni swipe è sempre un passo singolo. *Corri* tiene premuto B (scarpe da corsa).

Da computer: frecce, X = A, Z = B, A = L, S = R, Spazio = START, Shift = SELECT, M o Esc doppio = menu.

## Caricare una ROM

1. **Dal telefono** (consigliato): sugli occhiali scegli «Invia dal telefono», sul telefono apri `<sito>/invia.html`, inserisci il codice di 4 cifre e scegli il file. Il trasferimento è diretto (WebRTC); per l'aggancio usa il server pubblico gratuito di PeerJS (`?peerhost=host:porta` per usarne uno tuo).
2. **Scegli file**, se il browser degli occhiali lo permette.
3. **Da URL**: `<sito>/?rom=https://…/gioco.gba` (il server della ROM deve permettere CORS).

La ROM, i salvataggi in-game e un salvataggio automatico ogni 30 s restano nel browser (IndexedDB), quindi alla riapertura trovi «Continua».

## Pubblicazione

Serve un hosting HTTPS statico (GitHub Pages, Netlify, Vercel, Cloudflare Pages). mGBA usa i thread WebAssembly, che richiedono il *cross-origin isolation*: `sw.js` aggiunge da solo gli header COOP/COEP, quindi funziona anche su GitHub Pages. Su Netlify/Cloudflare il file `_headers` li imposta direttamente.

Installazione sugli occhiali: apri il sito dal computer, compare un QR «Installa sugli occhiali» (link `fb-viewapp://web_app_deep_link?...`) da inquadrare con il telefono, con la Modalità sviluppatore attiva nell'app Meta AI.

## Licenze

- mGBA (`mgba.js`, `mgba.wasm`, da [@thenick775/mgba-wasm](https://www.npmjs.com/package/@thenick775/mgba-wasm) 2.6.0): MPL-2.0
- PeerJS 1.5.4: MIT · qrcode-generator 1.4.4: MIT
