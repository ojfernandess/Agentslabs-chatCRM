-- A0: indexed column for Meta webhook inbox lookup (phone_number_id)
ALTER TABLE "inboxes" ADD COLUMN "whatsapp_phone_number_id" VARCHAR(100);

CREATE INDEX "inboxes_whatsapp_phone_number_id_idx" ON "inboxes"("whatsapp_phone_number_id");

UPDATE "inboxes"
SET "whatsapp_phone_number_id" = TRIM("channel_config"->>'whatsappPhoneNumberId')
WHERE "channel_type" = 'WHATSAPP'
  AND "channel_config" IS NOT NULL
  AND "channel_config"->>'whatsappPhoneNumberId' IS NOT NULL
  AND TRIM("channel_config"->>'whatsappPhoneNumberId') <> '';
