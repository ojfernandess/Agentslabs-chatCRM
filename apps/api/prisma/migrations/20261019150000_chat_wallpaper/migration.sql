ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "chat_wallpaper_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "chat_wallpaper_opacity" INTEGER NOT NULL DEFAULT 8;
