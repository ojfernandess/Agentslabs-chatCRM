export type ProcessRole = "all" | "api" | "worker" | "agent-worker";

function isAgentEngineDedicatedWorkerEnv(): boolean {
  const raw = process.env.AGENT_ENGINE_DEDICATED_WORKER;
  if (raw == null) return false;
  const inner = raw
    .replace(/^\ufeff/, "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(inner);
}

/** Lê PROCESS_ROLE (default `all` — comportamento monolítico legado). */
export function parseProcessRole(raw = process.env.PROCESS_ROLE): ProcessRole {
  const v = raw?.trim().toLowerCase();
  if (v === "api" || v === "worker" || v === "agent-worker") return v;
  return "all";
}

export function runsHttpApi(role: ProcessRole): boolean {
  return role === "all" || role === "api";
}

export function runsQueueWorkers(role: ProcessRole): boolean {
  return role === "all" || role === "worker" || role === "agent-worker";
}

/** Fila agent-engine-replies (BullMQ). */
export function runsAgentEngineWorker(role: ProcessRole): boolean {
  if (role === "agent-worker" || role === "all") return true;
  if (role === "worker") return !isAgentEngineDedicatedWorkerEnv();
  return false;
}

/** Broadcast, CRM, meta-inbound e demais filas gerais. */
export function runsGeneralQueueWorkers(role: ProcessRole): boolean {
  return role === "all" || role === "worker";
}

export function runsBackgroundSchedulers(role: ProcessRole): boolean {
  return role === "all" || role === "worker";
}

export function runsPresenceSweep(role: ProcessRole): boolean {
  return role === "all" || role === "api";
}
