import assert from "node:assert/strict";
import { test } from "node:test";
import { EventEmitter } from "node:events";
import {
  broadcastToConversation,
  broadcastToOrganization,
  getConversationSubscriberCount,
  registerWorkspaceSocket,
  resetWorkspaceHubForTests,
  subscribeWorkspaceSocketConversations,
} from "./workspaceHub.js";
import {
  resetConversationUpdatedDebounce,
  scheduleConversationUpdatedBroadcast,
} from "./workspaceConversationUpdatedDebounce.js";

class FakeSocket extends EventEmitter {
  readyState = 1;
  sent: string[] = [];
  send(raw: string): void {
    this.sent.push(raw);
  }
}

test("broadcastToConversation only reaches subscribed sockets", () => {
  resetWorkspaceHubForTests();
  const orgId = "org-1";
  const convA = "conv-a";
  const convB = "conv-b";
  const socketA = new FakeSocket();
  const socketB = new FakeSocket();
  registerWorkspaceSocket(orgId, socketA as never);
  registerWorkspaceSocket(orgId, socketB as never);
  subscribeWorkspaceSocketConversations(orgId, socketA as never, [convA]);
  subscribeWorkspaceSocketConversations(orgId, socketB as never, [convB]);

  broadcastToConversation(orgId, convA, { type: "message.created", conversationId: convA });

  assert.equal(socketA.sent.length, 1);
  assert.equal(socketB.sent.length, 0);
  assert.equal(getConversationSubscriberCount(orgId, convA), 1);
});

test("broadcastToConversation falls back to org when no subscribers", () => {
  resetWorkspaceHubForTests();
  const orgId = "org-2";
  const socket = new FakeSocket();
  registerWorkspaceSocket(orgId, socket as never);

  broadcastToConversation(orgId, "conv-x", { type: "message.created", conversationId: "conv-x" });

  assert.equal(socket.sent.length, 1);
});

test("scheduleConversationUpdatedBroadcast coalesces bursts", async () => {
  resetConversationUpdatedDebounce();
  const emitted: Array<{ conversationId: string; extra?: { status?: string } }> = [];
  scheduleConversationUpdatedBroadcast(
    "org-1",
    "conv-1",
    { status: "OPEN" },
    30,
    (_org, conversationId, extra) => {
      emitted.push({ conversationId, extra });
    },
  );
  scheduleConversationUpdatedBroadcast(
    "org-1",
    "conv-1",
    { updatedAt: "2026-01-01T00:00:00.000Z" },
    30,
    (_org, conversationId, extra) => {
      emitted.push({ conversationId, extra });
    },
  );

  await new Promise((r) => setTimeout(r, 45));
  assert.equal(emitted.length, 1);
  assert.equal(emitted[0]?.extra?.status, "OPEN");
  assert.equal(emitted[0]?.extra?.updatedAt, "2026-01-01T00:00:00.000Z");
});

test("broadcastToOrganization still fans out to all sockets", () => {
  resetWorkspaceHubForTests();
  const orgId = "org-3";
  const socketA = new FakeSocket();
  const socketB = new FakeSocket();
  registerWorkspaceSocket(orgId, socketA as never);
  registerWorkspaceSocket(orgId, socketB as never);

  broadcastToOrganization(orgId, { type: "user.availability_changed", userId: "u1", status: "online" });

  assert.equal(socketA.sent.length, 1);
  assert.equal(socketB.sent.length, 1);
});
