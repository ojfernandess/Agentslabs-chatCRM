/**
 * Fase 9 — Protocolo MCP de auditoria final (pipeline spine).
 */
export const SPINE_PIPELINE_LAYERS = [
  "prompt_compiler",
  "planner",
  "contract",
  "scheduler",
  "runtime",
  "llm",
  "supervisor",
] as const;

export type SpinePipelineLayer = (typeof SPINE_PIPELINE_LAYERS)[number];

export type McpExecutionSample = {
  executionId: string;
  status?: string;
  runtime?: string;
  timeline?: string[];
  events?: string[];
  tools?: Array<{ name: string; ok?: boolean }>;
  supervisorApproved?: boolean | null;
  replySynthesizerReason?: string | null;
  engineEvents?: string[];
  langfuseLayers?: string[];
};

export type PipelineVerification = {
  executionId: string;
  layersPresent: SpinePipelineLayer[];
  layersMissing: SpinePipelineLayer[];
  complete: boolean;
  notes: string[];
};

const LAYER_ALIASES: Record<SpinePipelineLayer, RegExp[]> = {
  prompt_compiler: [/prompt_compiler|compile|turn_context|prompt_ir|compiler/i],
  planner: [/planner|execution_plan|turn_plan|unified.?plan/i],
  contract: [/contract|execution_contract|eil/i],
  scheduler: [/scheduler|schedule_tools|tool_scheduler|pre_scheduled/i],
  runtime: [/runtime|execute_tool|tool_round|http_tool/i],
  llm: [/\bllm\b|openai|gemini|chat_completion/i],
  supervisor: [/supervisor|workflow_validator|violation/i],
};

function flattenExecutionText(sample: McpExecutionSample): string {
  return [
    sample.runtime ?? "",
    ...(sample.timeline ?? []),
    ...(sample.events ?? []),
    ...(sample.engineEvents ?? []),
    ...(sample.langfuseLayers ?? []),
    sample.replySynthesizerReason ?? "",
  ].join("\n");
}

export function verifySpinePipeline(sample: McpExecutionSample): PipelineVerification {
  const blob = flattenExecutionText(sample);
  const notes: string[] = [];
  const layersPresent: SpinePipelineLayer[] = [];
  const layersMissing: SpinePipelineLayer[] = [];

  for (const layer of SPINE_PIPELINE_LAYERS) {
    const found = LAYER_ALIASES[layer].some((re) => re.test(blob));
    if (found) layersPresent.push(layer);
    else layersMissing.push(layer);
  }

  if ((sample.engineEvents?.length ?? 0) > 0) {
    notes.push("engine_* events present");
  } else if (/engine_|UnifiedSpine|beginTurn/i.test(blob)) {
    notes.push("spine references in timeline");
  } else {
    notes.push("no engine_* events — spine may be off or legacy path");
  }

  if (sample.replySynthesizerReason === "ir_template") {
    notes.push("reply via IR template (Fase 6+)");
  } else if (sample.replySynthesizerReason === "reservation_s1") {
    notes.push("legacy reservation_s1 synthesizer path");
  }

  const complete =
    layersMissing.length <= 2 &&
    layersPresent.includes("contract") &&
    (layersPresent.includes("scheduler") || layersPresent.includes("runtime"));

  return {
    executionId: sample.executionId,
    layersPresent,
    layersMissing,
    complete,
    notes,
  };
}

/** Baseline MCP samples (Fase 0) — offline audit quando MCP indisponível. */
export const BASELINE_MCP_SAMPLES: McpExecutionSample[] = [
  {
    executionId: "748be9ec-be86-4cd6-891d-da67a02548f1",
    status: "success",
    runtime: "openconduit",
    timeline: [
      "inbound → context → rag → tool_scheduler → llm → audaar_consultar_reserva → reply_synthesizer (reservation_s1) → outbound",
    ],
    tools: [
      { name: "audaar_consultar_reserva", ok: true },
      { name: "audaar_consultar_disponibilidade", ok: true },
    ],
    replySynthesizerReason: "reservation_s1",
    supervisorApproved: null,
  },
  {
    executionId: "694676c4-a4df-4794-8bdf-dd6775bbcaa7",
    status: "success",
    runtime: "openconduit",
    timeline: [
      "inbound → context → rag → tool_scheduler → llm → reply_synthesizer (reservation_s1) → agent_engine_trace (langgraph) → outbound",
    ],
    replySynthesizerReason: "reservation_s1",
  },
];

/** Samples pós-reconstrução (simulador + spine shadow) — meta Fase 9. */
export const POST_REconstruction_MCP_SAMPLES: McpExecutionSample[] = [
  {
    executionId: "sim-vet-clinic",
    status: "simulated",
    runtime: "architecture_simulator",
    timeline: [
      "prompt_compiler → planner → contract → scheduler → runtime (dry-run)",
    ],
    langfuseLayers: ["prompt_compiler", "contract", "scheduler"],
    replySynthesizerReason: "ir_template",
    supervisorApproved: true,
    engineEvents: ["engine_beginTurn", "engine_finalize"],
  },
  {
    executionId: "sim-hotel-golden",
    status: "simulated",
    runtime: "architecture_simulator",
    timeline: [
      "prompt_compiler → planner → contract → scheduler → llm (sandbox) → supervisor",
    ],
    tools: [{ name: "audaar_consultar_reserva", ok: true }],
    engineEvents: ["engine_beginTurn"],
    replySynthesizerReason: "ir_template",
  },
];

export function verifyMcpAuditBatch(samples: McpExecutionSample[]): {
  total: number;
  pipelineComplete: number;
  verifications: PipelineVerification[];
} {
  const verifications = samples.map(verifySpinePipeline);
  return {
    total: verifications.length,
    pipelineComplete: verifications.filter((v) => v.complete).length,
    verifications,
  };
}
