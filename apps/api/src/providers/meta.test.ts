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

test("MetaCloudApiProvider parses status pricing from delivered webhook", () => {
  const provider = new MetaCloudApiProvider("token", "123");
  const parsed = provider.parseWebhook({}, {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: "1" },
              statuses: [
                {
                  id: "wamid.delivered",
                  status: "delivered",
                  timestamp: "1710000100",
                  pricing: {
                    billable: false,
                    pricing_model: "PMP",
                    type: "free_customer_service",
                    category: "service",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(parsed.statusUpdates.length, 1);
  assert.equal(parsed.statusUpdates[0]?.status, "DELIVERED");
  assert.equal(parsed.statusUpdates[0]?.metaPricing?.billable, false);
  assert.equal(parsed.statusUpdates[0]?.metaPricing?.type, "free_customer_service");
});

test("MetaCloudApiProvider parses inbound reaction add", () => {
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
                  from: "5511999990001",
                  id: "wamid.reaction",
                  type: "reaction",
                  reaction: { message_id: "wamid.target", emoji: "❤️" },
                  timestamp: "1710000200",
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(parsed.messages.length, 0);
  assert.equal(parsed.reactionUpdates?.length, 1);
  assert.equal(parsed.reactionUpdates?.[0]?.targetWaMessageId, "wamid.target");
  assert.equal(parsed.reactionUpdates?.[0]?.emoji, "❤️");
  assert.equal(parsed.reactionUpdates?.[0]?.from, "+5511999990001");
});

test("MetaCloudApiProvider parses inbound reaction removal", () => {
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
                  from: "5511999990001",
                  id: "wamid.reaction.remove",
                  type: "reaction",
                  reaction: { message_id: "wamid.target" },
                  timestamp: "1710000300",
                },
              ],
            },
          },
        ],
      },
    ],
  });
  assert.equal(parsed.reactionUpdates?.length, 1);
  assert.equal(parsed.reactionUpdates?.[0]?.emoji, "");
});
