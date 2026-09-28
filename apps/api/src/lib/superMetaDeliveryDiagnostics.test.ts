import assert from "node:assert/strict";
import test from "node:test";
import { MessageDirection, MessageStatus } from "@prisma/client";
import { diagnoseMetaDeliveryMessage } from "./metaDeliveryDiagnosisHints.js";

const baseOutbound = {
  direction: MessageDirection.OUTBOUND,
  status: MessageStatus.FAILED,
  providerMsgId: null,
  providerError: null,
  replyToMessageId: null,
  replyToExternalMsgId: null,
  isPrivate: false,
  channel: null,
};

test("diagnoseMetaDeliveryMessage — falha de rede sem wamid", () => {
  const { diagnosis, suggestedActions } = diagnoseMetaDeliveryMessage({
    message: {
      ...baseOutbound,
      providerError: "META_NETWORK_ERROR: UND_ERR_CONNECT_TIMEOUT",
    },
    ledger: null,
    replyTo: null,
    inboxProvider: "meta",
  });
  assert.ok(diagnosis.some((d) => d.includes("META_NETWORK_ERROR")));
  assert.ok(diagnosis.some((d) => d.includes("UND_ERR_CONNECT_TIMEOUT")));
  assert.ok(suggestedActions.some((a) => a.includes("graph.facebook.com")));
});

test("diagnoseMetaDeliveryMessage — falha genérica sem wamid", () => {
  const { diagnosis, suggestedActions } = diagnoseMetaDeliveryMessage({
    message: baseOutbound,
    ledger: null,
    replyTo: null,
    inboxProvider: "meta",
  });
  assert.ok(diagnosis.some((d) => d.includes("wamid")));
  assert.ok(suggestedActions.some((a) => a.includes("Reenvie") || a.includes("logs")));
});

test("diagnoseMetaDeliveryMessage — falha assíncrona com wamid", () => {
  const { diagnosis } = diagnoseMetaDeliveryMessage({
    message: { ...baseOutbound, providerMsgId: "wamid.HBgNtest" },
    ledger: { failedAt: new Date("2026-09-28T17:10:00.000Z") } as never,
    replyTo: null,
    inboxProvider: "meta",
  });
  assert.ok(diagnosis.some((d) => d.includes("webhook de status")));
});

test("diagnoseMetaDeliveryMessage — bloqueio janela 24h", () => {
  const { diagnosis, suggestedActions } = diagnoseMetaDeliveryMessage({
    message: baseOutbound,
    ledger: {
      billingStatus: "BLOCKED",
      policyDecision: "BLOCKED_WINDOW",
      policyReason: "Fora da janela de 24h — apenas templates aprovados",
    } as never,
    replyTo: null,
    inboxProvider: "meta",
  });
  assert.ok(diagnosis.some((d) => d.includes("janela 24h")));
  assert.ok(suggestedActions.some((a) => a.includes("template")));
});

test("diagnoseMetaDeliveryMessage — inclui providerError persistido", () => {
  const { diagnosis } = diagnoseMetaDeliveryMessage({
    message: {
      ...baseOutbound,
      providerError: "Meta API error: 400 Invalid parameter",
    },
    ledger: null,
    replyTo: null,
    inboxProvider: "meta",
  });
  assert.ok(diagnosis.some((d) => d.includes("Erro registado: Meta API error: 400")));
});

test("diagnoseMetaDeliveryMessage — código 131049 marketing cap", () => {
  const { diagnosis, suggestedActions } = diagnoseMetaDeliveryMessage({
    message: {
      ...baseOutbound,
      providerMsgId: "wamid.HBgNtest",
      providerError:
        "131049 — This message was not delivered to maintain healthy ecosystem engagement.",
    },
    ledger: null,
    replyTo: null,
    inboxProvider: "meta",
  });
  assert.ok(diagnosis.some((d) => d.includes("131049")));
  assert.ok(!diagnosis.some((d) => d.includes("número inválido")));
  assert.ok(suggestedActions.some((a) => a.includes("24 horas")));
});

test("diagnoseMetaDeliveryMessage — reply sem providerMsgId no alvo", () => {
  const { diagnosis, suggestedActions } = diagnoseMetaDeliveryMessage({
    message: { ...baseOutbound, replyToMessageId: "msg-1" },
    ledger: null,
    replyTo: { id: "msg-1", providerMsgId: null, direction: MessageDirection.INBOUND },
    inboxProvider: "meta",
  });
  assert.ok(diagnosis.some((d) => d.includes("citação")));
  assert.ok(diagnosis.some((d) => d.includes("não tem providerMsgId")));
});
