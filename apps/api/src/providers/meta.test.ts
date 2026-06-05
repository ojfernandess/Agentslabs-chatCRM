import assert from "node:assert/strict";
import test from "node:test";
import { MetaCloudApiProvider } from "./meta.js";

const META_INTERACTIVE = {
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "123456789" },
            contacts: [{ wa_id: "5511999990001", profile: { name: "Cliente" } }],
            messages: [
              {
                from: "5511999990001",
                id: "wamid.test",
                type: "interactive",
                interactive: { type: "button_reply", button_reply: { id: "yes", title: "Sim" } },
                timestamp: "1710000000",
              },
            ],
          },
        },
      ],
    },
  ],
};

test("MetaCloudApiProvider parses interactive inbound messages", () => {
  const provider = new MetaCloudApiProvider("token", "123");
  const parsed = provider.parseWebhook({}, META_INTERACTIVE);
  assert.equal(parsed.messages.length, 1);
  assert.equal(parsed.messages[0]?.body, "Sim");
  assert.equal(parsed.messages[0]?.type, "TEXT");
});

test("MetaCloudApiProvider parses button quick replies", () => {
  const provider = new MetaCloudApiProvider("token", "123");
  const parsed = provider.parseWebhook({}, {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "1" },
              messages: [
                {
                  from: "5511888880001",
                  id: "wamid.btn",
                  type: "button",
                  button: { text: "Quero saber mais" },
                  timestamp: "1710000001",
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(parsed.messages[0]?.body, "Quero saber mais");
});
