import assert from "node:assert/strict";
import test from "node:test";
import {
  buildKnowledgeSearchQuery,
  isShortConfirmationOrFlowReply,
  isUserDataProvisionMessage,
  resolveKnowledgeSearchSkip,
  shouldEnrichKnowledgeSearchQuery,
  shouldSkipKnowledgeSearchForTurn,
  isOperationalQuoteMessage,
  userMessageLooksLikeKnowledgeSeekingQuery,
  isKnowledgeOverviewChunk,
  knowledgeContentCoversQuery,
} from "./knowledgeQueryEnrichment.js";

test("shouldEnrichKnowledgeSearchQuery rejects menu digit replies", () => {
  assert.equal(shouldEnrichKnowledgeSearchQuery("1"), false);
  assert.equal(shouldEnrichKnowledgeSearchQuery("sim"), false);
  assert.equal(shouldEnrichKnowledgeSearchQuery("qual wifi?"), true);
});

test("buildKnowledgeSearchQuery does not pollute menu selection with history", () => {
  const q = buildKnowledgeSearchQuery("1", [
    { role: "user", content: "Hotel Brooklin" },
    { role: "assistant", content: "Posso te ajudar de duas formas" },
  ]);
  assert.equal(q, "1");
});

test("buildKnowledgeSearchQuery enriches short wifi query with establishment from history", () => {
  const q = buildKnowledgeSearchQuery("qual wifi?", [
    { role: "user", content: "Estou no Club Suítes — Base de Conhecimento" },
    { role: "assistant", content: "Olá! Como posso ajudar?" },
    { role: "user", content: "Club Suítes Campo Belo" },
  ]);
  assert.ok(q.toLowerCase().includes("wifi"));
  assert.ok(q.toLowerCase().includes("club"));
});

test("knowledgeContentCoversQuery false for header-only appendix", () => {
  const appendix = "### Base de conhecimento\n**1. Hotel X**\n## Categorias de quartos";
  assert.equal(knowledgeContentCoversQuery(appendix, "quais quartos?"), false);
});

test("knowledgeContentCoversQuery true when appendix contains wifi section data", () => {
  const appendix =
    "### Base de conhecimento\n**1. Hotel X**\n## WiFi\n- **Rede:** HOTEL X\n- **Senha:** abc123";
  assert.equal(knowledgeContentCoversQuery(appendix, "qual wifi?"), true);
});

test("isKnowledgeOverviewChunk detects catalog intro from optimized docs", () => {
  const intro =
    "## Rock Blue Ocean Suites — Base de Conhecimento\n\n" +
    "Documento da unidade **Rock Blue Ocean Suites** para consulta via buscar_conhecimento. " +
    "Seções com títulos que correspondem a possíveis buscas (WiFi, estacionamento, categorias de quartos, etc.).";
  assert.equal(isKnowledgeOverviewChunk(intro), true);
});

test("knowledgeContentCoversQuery false when only intro mentions room categories", () => {
  const intro =
    "## Rock Blue Ocean Suites — Base de Conhecimento\n\n" +
    "Documento da unidade **Rock Blue Ocean Suites** para consulta via buscar_conhecimento. " +
    "Seções com títulos que correspondem a possíveis buscas (WiFi, estacionamento, categorias de quartos, etc.).";
  assert.equal(
    knowledgeContentCoversQuery(intro, "quais as categorias de quartos do hotel Blue Ocean?"),
    false,
  );
});

test("knowledgeContentCoversQuery true when room section has facts", () => {
  const rooms =
    "## Categorias de quartos / Acomodações\n\n" +
    "- **Standard:** 12 m² · 1 hóspede\n" +
    "- **Superior:** 18 m² · 2 hóspedes";
  assert.equal(
    knowledgeContentCoversQuery(rooms, "quais as categorias de quartos do hotel Blue Ocean?"),
    true,
  );
});

test("knowledgeContentCoversQuery false for NF field label Quarto", () => {
  const nf =
    "## Nota fiscal (NF)\n\nPara emitir nota fiscal:\n\n- Nome completo\n- CPF\n- Quarto\n\n---";
  assert.equal(
    knowledgeContentCoversQuery(nf, "quais as categorias de quartos do hotel Blue Ocean?"),
    false,
  );
});

test("knowledgeContentCoversQuery false for room header without body facts", () => {
  const headerOnly = "## Categorias de quartos\n\nConsulte a recepção para mais detalhes.";
  assert.equal(
    knowledgeContentCoversQuery(headerOnly, "quais as categorias de quartos do hotel Blue Ocean?"),
    false,
  );
});

test("shouldSkipKnowledgeSearchForTurn on short confirmations", () => {
  assert.equal(isShortConfirmationOrFlowReply("sim"), true);
  assert.equal(isShortConfirmationOrFlowReply("ok"), true);
  assert.equal(isShortConfirmationOrFlowReply("não"), true);
  assert.equal(shouldSkipKnowledgeSearchForTurn("sim"), true);
  assert.equal(resolveKnowledgeSearchSkip("sim"), "short_confirmation");
});

test("shouldSkipKnowledgeSearchForTurn on CPF and localizer", () => {
  assert.equal(isUserDataProvisionMessage("699.606.761-88"), true);
  assert.equal(isUserDataProvisionMessage("A3FIULCZ"), true);
  assert.equal(shouldSkipKnowledgeSearchForTurn("699.606.761-88"), true);
  assert.equal(resolveKnowledgeSearchSkip("699.606.761-88"), "data_provision");
});

test("shouldSkipKnowledgeSearchForTurn during cadastro turn", () => {
  const skip = resolveKnowledgeSearchSkip("João Silva", {
    lastAssistantMessage: "Qual o seu nome completo para o cadastro?",
  });
  assert.equal(skip, "cadastro_turn");
});

test("shouldSkipKnowledgeSearchForTurn allows KB question during flow", () => {
  assert.equal(
    shouldSkipKnowledgeSearchForTurn("Qual o Wi-Fi do hotel?", {
      flowStep: "awaiting_selfie",
      hasFlowSlots: true,
    }),
    false,
  );
  assert.equal(userMessageLooksLikeKnowledgeSeekingQuery("Qual o Wi-Fi do hotel?"), true);
});

test("check-in with locator is not a knowledge-seeking query", () => {
  assert.equal(
    userMessageLooksLikeKnowledgeSeekingQuery("fazer check-in na reserva QP7ZVTOG"),
    false,
  );
  assert.equal(
    userMessageLooksLikeKnowledgeSeekingQuery("quero fazer check-in 71CRUDTI"),
    false,
  );
  assert.equal(userMessageLooksLikeKnowledgeSeekingQuery("Qual o Wi-Fi da suíte?"), true);
});

test("cotação and quote stay details are not knowledge-seeking queries", () => {
  assert.equal(userMessageLooksLikeKnowledgeSeekingQuery("gostaria de fazer uma cotação"), false);
  assert.equal(isOperationalQuoteMessage("gostaria de fazer uma cotação"), true);
  const stay = `na audaar tech
Data de chegada (check-in): 02/08/2026
Data de partida (checkout): 03/08/2026
2 pessoas`;
  assert.equal(userMessageLooksLikeKnowledgeSeekingQuery(stay), false);
  assert.equal(isOperationalQuoteMessage(stay), true);
});

test("resolveKnowledgeSearchSkip on check-in even without flow slots", () => {
  assert.equal(
    resolveKnowledgeSearchSkip("fazer check-in na reserva NCMT0VPN"),
    "checkin_reservation_turn",
  );
  assert.equal(
    resolveKnowledgeSearchSkip("preciso de ajuda com o quarto", {
      reservationLookupScheduled: true,
    }),
    "checkin_reservation_turn",
  );
  assert.equal(resolveKnowledgeSearchSkip("Qual o Wi-Fi?"), null);
});

test("shouldSkipKnowledgeSearchForTurn on active flow without KB intent", () => {
  assert.equal(
    resolveKnowledgeSearchSkip("123456", {
      flowStep: "awaiting_locator",
    }),
    "data_provision",
  );
  assert.equal(
    resolveKnowledgeSearchSkip("confirmado", {
      hasFlowSlots: true,
      lastToolRoundHadHttpTools: true,
    }),
    "short_confirmation",
  );
});
