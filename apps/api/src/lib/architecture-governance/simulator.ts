/**
 * Fase 8 — Architecture Simulator (pre-merge dry-run).
 * Reutiliza AgentTurnSimulator + cenários golden/generalization.
 */
import { simulateAgentTurn, simulateTurnContextOnly } from "../agent-engine/simulator/AgentTurnSimulator.js";
import { DEFAULT_AGENT_ENGINE_CONFIG } from "../agent-engine/types.js";
import type { TurnContext } from "../agent-engine/core/types.js";

export type ArchitectureSimScenarioId = "vet_clinic" | "hotel_reservation_lookup";

export type ArchitectureSimScenario = {
  id: ArchitectureSimScenarioId;
  description: string;
  userMessage: string;
  behaviorConfig: Record<string, unknown>;
  availableToolNames: string[];
  toolConfigs?: Array<{ name: string; config?: unknown }>;
  memory?: Record<string, unknown>;
};

export type ArchitectureSimResult = {
  scenarioId: ArchitectureSimScenarioId;
  passed: boolean;
  warnings: string[];
  turnContext?: TurnContext;
  pendingTools?: string[];
  scheduledCount?: number;
};

const VET_SCENARIO: ArchitectureSimScenario = {
  id: "vet_clinic",
  description: "Clínica Veterinária — prompt-only, zero hotel",
  userMessage: "Quero agendar consulta para o Rex amanhã",
  behaviorConfig: {
    promptBuilder: {
      userCore: `
## Objetivo
Agendar consulta veterinária.

## Ferramentas
| Confirmar | \`agendar_consulta\` |

## Restrições
Nunca inventar preços.
`,
    },
    eil: { enabled: true },
  },
  availableToolNames: ["agendar_consulta", "buscar_conhecimento"],
  toolConfigs: [
    {
      name: "agendar_consulta",
      config: { eil: { capabilities: ["booking"], produces: ["appointmentId"] } },
    },
  ],
  memory: { flowSlots: { petName: "Rex" } },
};

const HOTEL_SCENARIO: ArchitectureSimScenario = {
  id: "hotel_reservation_lookup",
  description: "Golden C3 — localizador → consultar_reserva",
  userMessage: "pode consultar essa reserva QP7ZVTOG",
  behaviorConfig: {
    promptBuilder: {
      useFullPrompt: true,
      userCore: `
| C2 | Verificar | consultar + localizador | Chame \`audaar_consultar_reserva\` |
| C3 | check-in localizador | Chame \`audaar_consultar_reserva\` |
Sempre use buscar_conhecimento quando necessário.
`,
    },
  },
  availableToolNames: ["audaar_consultar_reserva", "buscar_conhecimento"],
};

export const ARCHITECTURE_SIM_SCENARIOS: ArchitectureSimScenario[] = [VET_SCENARIO, HOTEL_SCENARIO];

export async function runArchitectureSimulatorScenario(
  scenario: ArchitectureSimScenario,
): Promise<ArchitectureSimResult> {
  const warnings: string[] = [];
  try {
    const sim = await simulateAgentTurn({
      organizationId: "sim-org",
      conversationId: "sim-conv",
      messageId: "sim-msg",
      botId: "sim-bot",
      userMessage: scenario.userMessage,
      engineConfig: { ...DEFAULT_AGENT_ENGINE_CONFIG, workflowEngineEnabled: false },
      behaviorConfig: scenario.behaviorConfig,
      memory: scenario.memory,
      availableToolNames: scenario.availableToolNames,
      runWorkflow: false,
    });

    const ctx = sim.turnContext;
    if (scenario.id === "vet_clinic") {
      const hotelLeak =
        /\bembratur\b/i.test(ctx.promptIr.objective ?? "") ||
        ctx.promptIr.preconditions.some((p) => p.includes("__templateFacts.checkinLink"));
      if (hotelLeak) warnings.push("vet_scenario_hotel_leak");
    }

    if (scenario.id === "hotel_reservation_lookup") {
      const required = ctx.turnPlan.requiredToolNames ?? [];
      const pending = ctx.executionContract.pendingToolNames;
      const hasReservation =
        required.some((n) => /consultar[_-]?reserva/i.test(n)) ||
        pending.some((n) => /consultar[_-]?reserva/i.test(n));
      if (!hasReservation) {
        warnings.push("hotel_scenario_missing_reservation_tool");
      }
    }

    if (sim.warnings.length) warnings.push(...sim.warnings);

    return {
      scenarioId: scenario.id,
      passed: warnings.length === 0,
      warnings,
      turnContext: ctx,
      pendingTools: ctx.executionContract.pendingToolNames,
      scheduledCount: sim.scheduledPlan.length,
    };
  } catch (err) {
    return {
      scenarioId: scenario.id,
      passed: false,
      warnings: [err instanceof Error ? err.message : "simulator_error"],
    };
  }
}

/** Executa todos os cenários obrigatórios de generalização + golden. */
export async function runArchitectureSimulator(
  scenarios: ArchitectureSimScenario[] = ARCHITECTURE_SIM_SCENARIOS,
): Promise<{ passed: boolean; results: ArchitectureSimResult[] }> {
  const results: ArchitectureSimResult[] = [];
  for (const s of scenarios) {
    results.push(await runArchitectureSimulatorScenario(s));
  }
  return { passed: results.every((r) => r.passed), results };
}

/** Simulação leve — só buildTurnContext (sem engine). */
export function simulateTurnContextQuick(opts: {
  turnId: string;
  behaviorConfig: Record<string, unknown>;
  userMessage: string;
  availableToolNames?: string[];
}): TurnContext {
  return simulateTurnContextOnly(opts);
}
