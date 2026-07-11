import { Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Layout } from "@/components/Layout";
import { LoginPage } from "@/pages/LoginPage";
import { ResetPasswordPage } from "@/pages/ResetPasswordPage";
import { AcceptInvitePage } from "@/pages/AcceptInvitePage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ReportsPage } from "@/pages/ReportsPage";
import { AiInsightsPage } from "@/pages/AiInsightsPage";
import { ConversationsLayout, ConversationsThreadPlaceholder } from "@/pages/ConversationsLayout";
import { ConversationDetailPage } from "@/pages/ConversationDetailPage";
import { ContactsPage } from "@/pages/ContactsPage";
import { ContactDetailPage } from "@/pages/ContactDetailPage";
import { RemindersPage } from "@/pages/RemindersPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { WavoipQrConnectPage } from "@/pages/settings/WavoipQrConnectPage";
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
import { ChatbotEmbedPage } from "@/pages/ChatbotEmbedPage";
import { BroadcastCampaignsPage } from "@/pages/BroadcastCampaignsPage";
import { InboxesPage } from "@/pages/InboxesPage";
import { EmailInboxLayout, EmailInboxThreadPlaceholder } from "@/pages/EmailInboxLayout";
import { PublicApiDocsPage } from "@/pages/PublicApiDocsPage";
import { isSuperAdminRole } from "@/lib/authRole";
import { TenantAdminRoute } from "@/components/TenantAdminRoute";

const ORG_FEATURE_DEFAULT_ENABLED = {
  crm_kanban: true,
  crm_deals: true,
  wavoip_voice: false,
  threecx_voice: false,
  nvoip_voice: false,
  nvoip_sms: false,
  nvoip_otp: false,
  nvoip_whatsapp: false,
} as const;

type OrgFeatureFlagKey = keyof typeof ORG_FEATURE_DEFAULT_ENABLED;

function OrgFeatureRoute({
  flagKey,
  children,
}: {
  flagKey: OrgFeatureFlagKey;
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
  const enabled =
    user?.organizationFeatures?.[flagKey] ?? ORG_FEATURE_DEFAULT_ENABLED[flagKey];
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
      <Route path="/chatbot/:publicId" element={<ChatbotEmbedPage />} />
      <Route path="/docs" element={<PublicApiDocsPage />} />
      <Route path="/login/reset" element={<ResetPasswordPage />} />
      <Route path="/login/invite" element={<AcceptInvitePage />} />
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
        <Route path="ai-insights" element={<AiInsightsPage />} />
        <Route path="conversations" element={<ConversationsLayout />}>
          <Route index element={<ConversationsThreadPlaceholder />} />
          <Route path=":id" element={<ConversationDetailPage />} />
        </Route>
        <Route path="my-attendance" element={<MyAttendancePage />} />
        <Route
          path="conversation-audit"
          element={
            <TenantAdminRoute>
              <ConversationAuditPage />
            </TenantAdminRoute>
          }
        />
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
        <Route
          path="settings"
          element={
            <TenantAdminRoute>
              <SettingsPage />
            </TenantAdminRoute>
          }
        />
        <Route
          path="settings/wavoip/:deviceId/qr"
          element={
            <TenantAdminRoute>
              <OrgFeatureRoute flagKey="wavoip_voice">
                <WavoipQrConnectPage />
              </OrgFeatureRoute>
            </TenantAdminRoute>
          }
        />
        <Route path="teams" element={<TeamsPage />} />
        <Route path="inboxes/:inboxId/email" element={<EmailInboxLayout />}>
          <Route index element={<EmailInboxThreadPlaceholder />} />
          <Route path="c/:id" element={<ConversationDetailPage />} />
        </Route>
        <Route path="inboxes" element={<InboxesPage />} />
        <Route
          path="bots"
          element={
            <TenantAdminRoute>
              <BotsPage />
            </TenantAdminRoute>
          }
        />
        <Route path="automation" element={<AutomationPage />} />
        <Route
          path="broadcasts"
          element={
            <TenantAdminRoute>
              <BroadcastCampaignsPage />
            </TenantAdminRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
