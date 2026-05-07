-- CreateEnum (alinhado a canais descritos na documentação do Chatwoot)
CREATE TYPE "InboxChannelType" AS ENUM (
  'WEBSITE',
  'FACEBOOK',
  'WHATSAPP',
  'SMS',
  'EMAIL',
  'API',
  'TELEGRAM',
  'LINE',
  'INSTAGRAM',
  'VOICE'
);

ALTER TABLE "inboxes" ADD COLUMN "channel_type" "InboxChannelType" NOT NULL DEFAULT 'WHATSAPP';
