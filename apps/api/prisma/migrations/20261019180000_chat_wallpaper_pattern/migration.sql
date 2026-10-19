ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "chat_wallpaper_pattern" VARCHAR(32) NOT NULL DEFAULT 'standard';
