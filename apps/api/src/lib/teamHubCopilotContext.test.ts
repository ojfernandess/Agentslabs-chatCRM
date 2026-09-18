import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.DATABASE_URL ??= "postgresql://test:test@localhost:5432/test";
process.env.JWT_SECRET ??= "test-secret";

const {
  formatTeamHubCopilotConversationBlock,
  formatTeamHubCopilotStatsBlock,
  formatTeamHubCopilotSystemPrompt,
  formatTeamHubCopilotUserContext,
  teamHubCopilotMaxConversations,
  teamHubCopilotMaxMessages,
} = await import("./teamHubCopilotContext.js");

type TeamHubCopilotLoadedContext = Parameters<typeof formatTeamHubCopilotSystemPrompt>[0];

function sampleContext(overrides: Partial<TeamHubCopilotLoadedContext> = {}): TeamHubCopilotLoadedContext {
  return {
    team: {
      id: "team-1",
      name: "Suporte",
      isOrgCollaborationSpace: false,
      purpose: "OPERATIONAL",
    },
    totalCount: 42,
    sampledCount: 2,
    maxConversations: 15,
    byStatus: { OPEN: 10, PENDING: 5, RESOLVED: 27 },
    byInbox: [
      { name: "WhatsApp", count: 30 },
      { name: "E-mail", count: 12 },
    ],
    conversations: [
      {
        id: "conv-1",
        status: "OPEN",
        priority: "HIGH",
        updatedAt: new Date("2026-09-18T12:00:00.000Z"),
        closureValue: 1500,
        assignedTo: { name: "Ana" },
        inbox: { name: "WhatsApp" },
        team: { name: "Suporte" },
        leadType: { name: "Enterprise" },
        contact: {
          name: "João Silva",
          tags: [{ tag: { name: "VIP" } }, { tag: { name: "Renovação" } }],
          pipelineStage: { name: "Proposta" },
          dealsPrimary: [
            {
              name: "Contrato anual",
              amountCents: 120000,
              status: "OPEN",
              currency: "BRL",
            },
          ],
        },
        messages: [
          { direction: "INBOUND", body: "Preciso de ajuda", isPrivate: false },
          { direction: "OUTBOUND", body: "Claro, em que posso ajudar?", isPrivate: false },
        ],
      },
    ],
    ...overrides,
  };
}

describe("teamHubCopilotMaxConversations", () => {
  it("returns default when env is unset", () => {
    const prev = process.env.TEAM_COPILOT_MAX_CONVERSATIONS;
    delete process.env.TEAM_COPILOT_MAX_CONVERSATIONS;
    assert.equal(teamHubCopilotMaxConversations(), 15);
    if (prev !== undefined) process.env.TEAM_COPILOT_MAX_CONVERSATIONS = prev;
  });

  it("clamps invalid values", () => {
    const prev = process.env.TEAM_COPILOT_MAX_CONVERSATIONS;
    process.env.TEAM_COPILOT_MAX_CONVERSATIONS = "999";
    assert.equal(teamHubCopilotMaxConversations(), 40);
    process.env.TEAM_COPILOT_MAX_CONVERSATIONS = "1";
    assert.equal(teamHubCopilotMaxConversations(), 3);
    if (prev !== undefined) process.env.TEAM_COPILOT_MAX_CONVERSATIONS = prev;
    else delete process.env.TEAM_COPILOT_MAX_CONVERSATIONS;
  });
});

describe("teamHubCopilotMaxMessages", () => {
  it("returns default when env is unset", () => {
    const prev = process.env.TEAM_COPILOT_MAX_MESSAGES;
    delete process.env.TEAM_COPILOT_MAX_MESSAGES;
    assert.equal(teamHubCopilotMaxMessages(), 12);
    if (prev !== undefined) process.env.TEAM_COPILOT_MAX_MESSAGES = prev;
  });
});

describe("formatTeamHubCopilotSystemPrompt", () => {
  it("scopes operational teams to the team name", () => {
    const prompt = formatTeamHubCopilotSystemPrompt(sampleContext());
    assert.match(prompt, /equipe «Suporte»/);
    assert.match(prompt, /português do Brasil/);
  });

  it("scopes org collaboration space to all inboxes", () => {
    const prompt = formatTeamHubCopilotSystemPrompt(
      sampleContext({
        team: {
          id: "org-space",
          name: "Comunicação interna",
          isOrgCollaborationSpace: true,
          purpose: "INTERNAL_COMMUNICATION",
        },
      }),
    );
    assert.match(prompt, /todas as caixas e conversas da organização/);
  });
});

describe("formatTeamHubCopilotStatsBlock", () => {
  it("includes totals, status breakdown and inbox counts", () => {
    const block = formatTeamHubCopilotStatsBlock(sampleContext());
    assert.match(block, /Total no escopo: 42 \(2 conversas mais recentes de 42 no escopo\)/);
    assert.match(block, /OPEN 10 · PENDING 5 · RESOLVED 27/);
    assert.match(block, /WhatsApp \(30\), E-mail \(12\)/);
  });
});

describe("formatTeamHubCopilotConversationBlock", () => {
  it("renders metadata, tags, funnel stage and transcript", () => {
    const block = formatTeamHubCopilotConversationBlock(sampleContext().conversations[0]!, 0);
    assert.match(block, /Contato: João Silva/);
    assert.match(block, /Etiquetas: VIP, Renovação/);
    assert.match(block, /Estágio do funil: Proposta/);
    assert.match(block, /Negócios abertos: Contrato anual/);
    assert.match(block, /Preciso de ajuda/);
    assert.match(block, /Claro, em que posso ajudar\?/);
  });
});

describe("formatTeamHubCopilotUserContext", () => {
  it("combines stats, conversation detail and user prompt", () => {
    const content = formatTeamHubCopilotUserContext(sampleContext(), "Quais conversas estão paradas?");
    assert.match(content, /Resumo operacional:/);
    assert.match(content, /--- Conversa #1 ---/);
    assert.match(content, /Pedido do usuário:\nQuais conversas estão paradas\?/);
  });
});
