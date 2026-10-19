import assert from "node:assert/strict";
import test from "node:test";
import { chatWallpaperFromSettings, clampChatWallpaperOpacity } from "./chatWallpaper.js";

test("missing wallpaper settings stay off", () => {
  assert.deepEqual(chatWallpaperFromSettings(null), { enabled: false, opacity: 8 });
  assert.deepEqual(chatWallpaperFromSettings({}), { enabled: false, opacity: 8 });
});

test("opacity stays between 0 and 30", () => {
  assert.equal(clampChatWallpaperOpacity(0), 0);
  assert.equal(clampChatWallpaperOpacity(8), 8);
  assert.equal(clampChatWallpaperOpacity(30), 30);
  assert.equal(clampChatWallpaperOpacity(80), 30);
  assert.equal(clampChatWallpaperOpacity(-4), 0);
});
