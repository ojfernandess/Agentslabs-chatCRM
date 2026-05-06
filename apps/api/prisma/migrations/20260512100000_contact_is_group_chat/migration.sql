-- WhatsApp group chats: contact rows use synthetic E.164 (+888…) and wa_id = group JID.
ALTER TABLE "contacts" ADD COLUMN "is_group_chat" BOOLEAN NOT NULL DEFAULT false;
