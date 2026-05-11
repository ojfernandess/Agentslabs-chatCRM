import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/LoginPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { ConversationsPage } from "@/pages/ConversationsPage";
import { ConversationDetailPage } from "@/pages/ConversationDetailPage";
import { ContactsPage } from "@/pages/ContactsPage";
import { ContactDetailPage } from "@/pages/ContactDetailPage";
import { RemindersPage } from "@/pages/RemindersPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { CrmKanbanPage } from "@/pages/CrmKanbanPage";
import { DealsPage } from "@/pages/DealsPage";
import { SuperAdminPage } from "@/pages/SuperAdminPage";
import { TeamsPage } from "@/pages/TeamsPage";
import { BotsPage } from "@/pages/BotsPage";
import { AutomationPage } from "@/pages/AutomationPage";
import { MyAttendancePage } from "@/pages/MyAttendancePage";
import { ConversationAuditPage } from "@/pages/ConversationAuditPage";
import { CsatPage } from "@/pages/CsatPage";
import { BroadcastCampaignsPage } from "@/pages/BroadcastCampaignsPage";
import { InboxesPage } from "@/pages/InboxesPage";
import { PublicApiDocsPage } from "@/pages/PublicApiDocsPage";
import { isSuperAdminRole } from "@/lib/authRole";

function OrgFeatureRoute({
  flagKey,
  children,
}: {
  flagKey: "crm_kanban" | "crm_deals";
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }
  const enabled = user?.organizationFeatures?.[flagKey] ?? true;
  if (!enabled) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function TenantOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (isSuperAdminRole(user?.role) && !user?.actingOrganizationId) {
    return <Navigate to="/super" replace />;
  }
  return <>{children}</>;
}

function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!isSuperAdminRole(user?.role)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

/**
 * Rotas tenant: layout sem `path` (RR7), para nunca competir com `/super`.
 * Filhos usam paths relativos → `/`, `/conversations`, …
 */
export function App() {
  return (
    <Routes>
      <Route path="/csat/:token" element={<CsatPage />} />
      <Route path="/docs" element={<PublicApiDocsPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/super"
        element={
          <ProtectedRoute>
            <SuperAdminOnly>
              <SuperAdminPage />
            </SuperAdminOnly>
          </ProtectedRoute>
        }
      />
      <Route
        element={
          <ProtectedRoute>
            <TenantOnly>
              <Layout />
            </TenantOnly>
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="conversations" element={<ConversationsPage />} />
        <Route path="conversations/:id" element={<ConversationDetailPage />} />
        <Route path="my-attendance" element={<MyAttendancePage />} />
        <Route path="conversation-audit" element={<ConversationAuditPage />} />
        <Route path="contacts" element={<ContactsPage />} />
        <Route path="contacts/:id" element={<ContactDetailPage />} />
        <Route
          path="crm"
          element={
            <OrgFeatureRoute flagKey="crm_kanban">
              <CrmKanbanPage />
            </OrgFeatureRoute>
          }
        />
        <Route
          path="deals"
          element={
            <OrgFeatureRoute flagKey="crm_deals">
              <DealsPage />
            </OrgFeatureRoute>
          }
        />
        <Route path="reminders" element={<RemindersPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="inboxes" element={<InboxesPage />} />
        <Route path="bots" element={<BotsPage />} />
        <Route path="automation" element={<AutomationPage />} />
        <Route path="broadcasts" element={<BroadcastCampaignsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
