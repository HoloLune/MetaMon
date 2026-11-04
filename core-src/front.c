// MetaMon minimal libretro frontend for the mGBA core (compiled to WebAssembly with Emscripten).
// No RetroArch, no Asyncify: JavaScript calls mm_run(n) from a timer and reads video/audio back.
#include <stdint.h>
#include <stdbool.h>
#include <string.h>
#include <stdlib.h>
#include <emscripten/emscripten.h>
#include "libretro.h"

static const void* frame_ptr; static unsigned frame_w, frame_h; static size_t frame_pitch; static int frame_new;
static int16_t* audio_buf; static size_t audio_frames, audio_cap;
static uint16_t keys; static unsigned frames_run;
static struct retro_system_av_info av;

// core options: emulate every frame but render only every other one (the glasses show 30 Hz)
static const char* option(const char* key) {
  if (!strcmp(key, "mgba_frameskip")) return "fixed_interval";
  if (!strcmp(key, "mgba_frameskip_interval")) return getenv("MM_FRAMESKIP") ? getenv("MM_FRAMESKIP") : "1";
  if (!strcmp(key, "mgba_idle_optimization")) return "Remove Known";
  if (!strcmp(key, "mgba_audio_low_pass_filter")) return "disabled";
  if (!strcmp(key, "mgba_color_correction")) return "OFF";
  if (!strcmp(key, "mgba_interframe_blending")) return "OFF";
  if (!strcmp(key, "mgba_use_bios")) return "OFF";
  if (!strcmp(key, "mgba_skip_bios")) return "ON";
  if (!strcmp(key, "mgba_allow_opposing_directions")) return "no";
  if (!strcmp(key, "mgba_force_gbp")) return "OFF";
  if (!strcmp(key, "mgba_sgb_borders")) return "OFF";
  if (!strcmp(key, "mgba_gb_model")) return "Autodetect";
  return NULL;
}
static bool environment(unsigned cmd, void* data) {
  switch (cmd) {
  case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: return *(enum retro_pixel_format*)data == RETRO_PIXEL_FORMAT_RGB565;
  case RETRO_ENVIRONMENT_GET_VARIABLE: { struct retro_variable* v = data; v->value = option(v->key); return v->value != NULL; }
  case RETRO_ENVIRONMENT_GET_VARIABLE_UPDATE: *(bool*)data = false; return true;
  case RETRO_ENVIRONMENT_GET_CAN_DUPE: *(bool*)data = true; return true;
  case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS: return true;
  case RETRO_ENVIRONMENT_SET_INPUT_DESCRIPTORS: case RETRO_ENVIRONMENT_SET_MEMORY_MAPS:
  case RETRO_ENVIRONMENT_SET_SUPPORT_ACHIEVEMENTS: case RETRO_ENVIRONMENT_SET_SUPPORT_NO_GAME:
  case RETRO_ENVIRONMENT_SET_SYSTEM_AV_INFO: return true;
  default: return false;
  }
}
static void video(const void* data, unsigned w, unsigned h, size_t pitch) {
  if (!data) return;                     // skipped frame: keep the last picture
  frame_ptr = data; frame_w = w; frame_h = h; frame_pitch = pitch; frame_new = 1;
}
static size_t audio_batch(const int16_t* data, size_t frames) {
  if (audio_frames + frames > audio_cap) {
    audio_cap = (audio_frames + frames) * 2;
    audio_buf = realloc(audio_buf, audio_cap * 2 * sizeof(int16_t));
  }
  memcpy(audio_buf + audio_frames * 2, data, frames * 2 * sizeof(int16_t));
  audio_frames += frames;
  return frames;
}
static void audio_sample(int16_t l, int16_t r) { int16_t s[2] = { l, r }; audio_batch(s, 1); }
static void input_poll(void) {}
static int16_t input_state(unsigned port, unsigned device, unsigned index, unsigned id) {
  if (port || device != RETRO_DEVICE_JOYPAD) return 0;
  if (id == RETRO_DEVICE_ID_JOYPAD_MASK) return keys;
  return (keys >> id) & 1;
}

EMSCRIPTEN_KEEPALIVE int mm_init(void) {
  retro_set_environment(environment);
  retro_set_video_refresh(video);
  retro_set_audio_sample(audio_sample);
  retro_set_audio_sample_batch(audio_batch);
  retro_set_input_poll(input_poll);
  retro_set_input_state(input_state);
  retro_init();
  return 1;
}
EMSCRIPTEN_KEEPALIVE int mm_load(const void* rom, size_t size, int frameskip) {
  static char fs[4]; fs[0] = '0' + (frameskip & 7); fs[1] = 0; setenv("MM_FRAMESKIP", fs, 1);
  struct retro_game_info info = { .path = "game.gba", .data = rom, .size = size, .meta = NULL };
  if (!retro_load_game(&info)) return 0;
  retro_get_system_av_info(&av);
  return 1;
}
EMSCRIPTEN_KEEPALIVE void mm_run(int n) { while (n-- > 0) { retro_run(); frames_run++; } }
EMSCRIPTEN_KEEPALIVE void mm_set_keys(int k) { keys = (uint16_t)k; }
EMSCRIPTEN_KEEPALIVE unsigned mm_frames(void) { return frames_run; }
EMSCRIPTEN_KEEPALIVE int mm_frame_new(void) { int n = frame_new; frame_new = 0; return n; }
EMSCRIPTEN_KEEPALIVE const void* mm_frame_ptr(void) { return frame_ptr; }
EMSCRIPTEN_KEEPALIVE unsigned mm_frame_w(void) { return frame_w; }
EMSCRIPTEN_KEEPALIVE unsigned mm_frame_h(void) { return frame_h; }
EMSCRIPTEN_KEEPALIVE unsigned mm_frame_pitch(void) { return (unsigned)frame_pitch; }
EMSCRIPTEN_KEEPALIVE double mm_sample_rate(void) { return av.timing.sample_rate; }
EMSCRIPTEN_KEEPALIVE double mm_fps(void) { return av.timing.fps; }
EMSCRIPTEN_KEEPALIVE const int16_t* mm_audio_ptr(void) { return audio_buf; }
EMSCRIPTEN_KEEPALIVE unsigned mm_audio_take(void) { unsigned n = (unsigned)audio_frames; audio_frames = 0; return n; }
EMSCRIPTEN_KEEPALIVE void* mm_save_ptr(void) { return retro_get_memory_data(RETRO_MEMORY_SAVE_RAM); }
EMSCRIPTEN_KEEPALIVE unsigned mm_save_size(void) { return (unsigned)retro_get_memory_size(RETRO_MEMORY_SAVE_RAM); }
EMSCRIPTEN_KEEPALIVE unsigned mm_state_size(void) { return (unsigned)retro_serialize_size(); }
EMSCRIPTEN_KEEPALIVE int mm_state_save(void* buf, unsigned size) { return retro_serialize(buf, size); }
EMSCRIPTEN_KEEPALIVE int mm_state_load(const void* buf, unsigned size) { return retro_unserialize(buf, size); }
EMSCRIPTEN_KEEPALIVE void mm_reset(void) { retro_reset(); }
