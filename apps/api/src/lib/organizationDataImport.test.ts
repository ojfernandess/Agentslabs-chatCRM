import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseOrganizationImportCsv,
  parseOrganizationImportJson,
} from "./organizationDataImport.js";

describe("organizationDataImport parsers", () => {
  it("parses JSON export payload", () => {
    const payload = parseOrganizationImportJson(
      Buffer.from(
        JSON.stringify({
          contacts: [{ id: "c1", name: "Ana", phone: "+5511999990000", email: "", company: "", notes: "", tags: "" }],
          conversations: [
            {
              id: "v1",
              status: "OPEN",
              priority: "",
              contact: { id: "c1", name: "Ana", phone: "+5511999990000", email: null },
              messageCount: 1,
            },
          ],
          messages: [
            {
              id: "m1",
              conversationId: "v1",
              direction: "INBOUND",
              type: "TEXT",
              body: "Olá",
              sentAt: "2026-01-01T10:00:00.000Z",
            },
          ],
        }),
      ),
    );

    assert.equal(payload.contacts.length, 1);
    assert.equal(payload.conversations.length, 1);
    assert.equal(payload.messages.length, 1);
    assert.equal(payload.messages[0]?.body, "Olá");
  });

  it("parses CSV export sections", () => {
    const csv = [
      "# CONTACTS",
      "id,name,phone,email,company,notes,tags,created_at,updated_at",
      "c1,Ana,+5511999990000,ana@example.com,,,vip,2026-01-01T10:00:00.000Z,2026-01-01T10:00:00.000Z",
      "",
      "# CONVERSATIONS",
      "id,status,priority,contact_id,contact_name,contact_phone,inbox,channel,assigned_to,message_count,created_at,updated_at",
      "v1,OPEN,,c1,Ana,+5511999990000,Principal,WHATSAPP,,1,2026-01-01T10:00:00.000Z,2026-01-01T10:00:00.000Z",
      "",
      "# MESSAGES",
      "id,conversation_id,direction,type,body,media_url,channel,actor_name,contact_name,contact_phone,inbox,sent_at",
      "m1,v1,INBOUND,TEXT,Olá,,WHATSAPP,,Ana,+5511999990000,Principal,2026-01-01T10:00:00.000Z",
    ].join("\n");

    const payload = parseOrganizationImportCsv(Buffer.from(csv, "utf8"));
    assert.equal(payload.contacts[0]?.name, "Ana");
    assert.equal(payload.conversations[0]?.contact.phone, "+5511999990000");
    assert.equal(payload.messages[0]?.conversationId, "v1");
  });
});
