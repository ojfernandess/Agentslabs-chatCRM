import { useAuth } from "@/hooks/useAuth";
import { TeamsCollaborationHub } from "@/components/teams-hub/TeamsCollaborationHub";

/** Centro de colaboração com abas (visão geral, canais, workspace, admin). */
export function TeamsPage() {
  return <TeamsCollaborationHub />;
}
