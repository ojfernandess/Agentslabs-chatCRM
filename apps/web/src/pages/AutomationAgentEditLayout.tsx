import { useParams } from "react-router-dom";
import { AgentEditRouteProvider } from "@/context/AgentEditRouteContext";
import { AutomationPage } from "@/pages/AutomationPage";

/** Rota dedicada `/automation/agents/:botId` — mesmo editor que o modal, em layout de página. */
export function AutomationAgentEditLayout() {
  const { botId } = useParams();
  if (!botId) return null;
  return (
    <AgentEditRouteProvider botId={botId}>
      <AutomationPage />
    </AgentEditRouteProvider>
  );
}
