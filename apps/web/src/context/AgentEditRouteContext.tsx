import { createContext, useContext, type ReactNode } from "react";

const AgentEditBotIdContext = createContext<string | undefined>(undefined);

export function AgentEditRouteProvider({ botId, children }: { botId: string; children: ReactNode }) {
  return <AgentEditBotIdContext.Provider value={botId}>{children}</AgentEditBotIdContext.Provider>;
}

/** UUID do bot quando a rota é `/automation/agents/:botId`; fora dessa rota é `undefined`. */
export function useOptionalAgentEditBotIdFromRoute(): string | undefined {
  return useContext(AgentEditBotIdContext);
}
