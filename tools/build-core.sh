#!/bin/sh
# Builds core/mgba.js + core/mgba.wasm: the mGBA libretro core (github.com/libretro/mgba) plus our
# minimal frontend core-src/front.c, with Emscripten (no RetroArch, no Asyncify, no threads).
# Usage: tools/build-core.sh /path/to/mgba-source   (needs emsdk activated: emcc on PATH)
set -e
SRC=${1:?path to libretro/mgba checkout}
OUT=$(cd "$(dirname "$0")/.." && pwd)
B=$(mktemp -d)
cd "$B"
emcmake cmake "$SRC" -DBUILD_LIBRETRO=ON -DLIBRETRO_STATIC=ON -DBUILD_QT=OFF -DBUILD_SDL=OFF -DBUILD_GL=OFF \
  -DBUILD_GLES2=OFF -DBUILD_GLES3=OFF -DUSE_ZLIB=OFF -DUSE_PNG=OFF -DUSE_LIBZIP=OFF -DUSE_MINIZIP=OFF \
  -DUSE_SQLITE3=OFF -DUSE_ELF=OFF -DUSE_LZMA=OFF -DUSE_FFMPEG=OFF -DUSE_EDITLINE=OFF -DUSE_DISCORD_RPC=OFF \
  -DUSE_LUA=OFF -DUSE_JSON_C=OFF -DENABLE_SCRIPTING=OFF -DUSE_DEBUGGERS=OFF -DUSE_GDB_STUB=OFF \
  -DSKIP_LIBRARY=ON -DBUILD_SHARED=OFF -DBUILD_STATIC=OFF -DCMAKE_BUILD_TYPE=Release
emmake make -j4 mgba_libretro
cp mgba_libretro.bc libmgba_libretro.a
emcc -O3 "$OUT/core-src/front.c" -L. -lmgba_libretro -I"$SRC/src/platform/libretro" -o "$OUT/core/mgba.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=33554432 -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS=_malloc,_free -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU16,HEAP16
echo "built $OUT/core/mgba.js and mgba.wasm"
