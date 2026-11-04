#!/bin/sh
# Rebuild ejs/data/emulator.min.js from ejs/data/src (EmulatorJS loads it when EJS_DEBUG_XX is off).
# socket.io (netplay) is left out: MetaMon never uses netplay. Needs `npx terser`.
set -e
cd "$(dirname "$0")/../ejs/data"
for f in emulator nipplejs shaders storage gamepad GameManager compression; do cat "src/$f.js"; echo ';'; done > /tmp/ejs-concat.js
npx --yes terser@5 /tmp/ejs-concat.js --compress --mangle --ecma 2020 -o emulator.min.js
npx --yes terser@5 --version >/dev/null
echo "emulator.min.js: $(wc -c < emulator.min.js) bytes"
