-- Allow agents to access the Inboxes page when enabled by org admin.
ALTER TABLE "settings" ADD COLUMN "agents_inboxes_visible" BOOLEAN NOT NULL DEFAULT false;
