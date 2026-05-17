import { useAuth } from "@/hooks/useAuth";
import { TeamsLegacyPage } from "@/pages/TeamsLegacyPage";
import { TeamsCollaborationHub } from "@/components/teams-hub/TeamsCollaborationHub";

export function TeamsPage() {
  const { user } = useAuth();
  const hubEnabled = user?.organizationFeatures?.teams_collaboration_hub ?? false;

  if (hubEnabled) {
    return <TeamsCollaborationHub />;
  }

  return <TeamsLegacyPage />;
}
