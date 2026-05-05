import { useState, useEffect, type FormEvent } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/useAuth";
import { Settings, Wifi, WifiOff, Copy, Check, UserPlus, Bell, Tag, Smartphone } from "lucide-react";
import { PageTransition, motion, staggerContainer, staggerItem } from "@/components/Motion";
import { useI18n } from "@/i18n/I18nProvider";
import { isTenantAdmin } from "@/lib/authRole";
import clsx from "clsx";

type SettingsSection = "channel" | "notifications" | "crm" | "team";

interface AppSettings {
  whatsappProvider: string | null;
  whatsappApiKey: string | null;
  whatsappPhoneNumberId: string | null;
  evolutionApiBaseUrl: string | null;
  whatsappWebhookSecret: string | null;
  autoOptInOnFirstMessage: boolean;
  notifyConversationOpen: boolean;
  notifyConversationPending: boolean;
  webhookUrl: string;
}

interface LeadTypeRow {
  id: string;
  name: string;
  color: string;
  order: number;
}

interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "AGENT";
  createdAt: string;
}

export function SettingsPage() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [section, setSection] = useState<SettingsSection>("channel");
  const isAdmin = isTenantAdmin(user?.role, user?.actingOrganizationId);
  const effectiveOrgId = user?.actingOrganizationId ?? user?.organizationId ?? null;
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  const [provider, setProvider] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [phoneNumberId, setPhoneNumberId] = useState("");
  const [evolutionBaseUrl, setEvolutionBaseUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [autoOptIn, setAutoOptIn] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(true);
  const [notifyPending, setNotifyPending] = useState(true);

  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"ADMIN" | "AGENT">("AGENT");
  const [userFormError, setUserFormError] = useState("");
  const [userFormSubmitting, setUserFormSubmitting] = useState(false);

  const [leadTypes, setLeadTypes] = useState<LeadTypeRow[]>([]);
  const [newLtName, setNewLtName] = useState("");
  const [newLtColor, setNewLtColor] = useState("#6366f1");
  const [ltError, setLtError] = useState("");
  const [ltSubmitting, setLtSubmitting] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    async function load() {
      try {
        const [data, users, lt] = await Promise.all([
          api.get<AppSettings>("/settings"),
          api.get<TeamUser[]>("/users"),
          api.get<LeadTypeRow[]>("/lead-types"),
        ]);
        setSettings(data);
        setProvider(data.whatsappProvider ?? "");
        setPhoneNumberId(data.whatsappPhoneNumberId ?? "");
        setEvolutionBaseUrl(data.evolutionApiBaseUrl ?? "");
        setAutoOptIn(data.autoOptInOnFirstMessage);
        setNotifyOpen(data.notifyConversationOpen ?? true);
        setNotifyPending(data.notifyConversationPending ?? true);
        setTeamUsers(users);
        setLeadTypes(lt);
      } catch {
        // failed
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [isAdmin]);

  const handleAddLeadType = async (e: FormEvent) => {
    e.preventDefault();
    setLtError("");
    if (!newLtName.trim()) return;
    setLtSubmitting(true);
    try {
      const nextOrder =
        leadTypes.length === 0 ? 0 : Math.max(...leadTypes.map((l) => l.order)) + 1;
      await api.post<LeadTypeRow>("/lead-types", {
        name: newLtName.trim(),
        color: newLtColor,
        order: nextOrder,
      });
      setNewLtName("");
      setNewLtColor("#6366f1");
      setLeadTypes(await api.get<LeadTypeRow[]>("/lead-types"));
    } catch (err) {
      setLtError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLtSubmitting(false);
    }
  };

  const handleDeleteLeadType = async (id: string) => {
    try {
      await api.delete(`/lead-types/${id}`);
      setLeadTypes(await api.get<LeadTypeRow[]>("/lead-types"));
    } catch {
      /* ignore */
    }
  };

  const handleAddUser = async (e: FormEvent) => {
    e.preventDefault();
    setUserFormError("");
    setUserFormSubmitting(true);
    try {
      await api.post<TeamUser>("/users", {
        name: newUserName,
        email: newUserEmail,
        password: newUserPassword,
        role: newUserRole,
      });
      setNewUserName("");
      setNewUserEmail("");
      setNewUserPassword("");
      setNewUserRole("AGENT");
      const users = await api.get<TeamUser[]>("/users");
      setTeamUsers(users);
    } catch (err) {
      setUserFormError(err instanceof Error ? err.message : "Failed to create user");
    } finally {
      setUserFormSubmitting(false);
    }
  };

  const handleSaveNotifications = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const data = await api.put<AppSettings>("/settings", {
        notifyConversationOpen: notifyOpen,
        notifyConversationPending: notifyPending,
      });
      setSettings(data);
      setNotifyOpen(data.notifyConversationOpen ?? true);
      setNotifyPending(data.notifyConversationPending ?? true);
    } catch {
      /* failed */
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        autoOptInOnFirstMessage: autoOptIn,
      };
      if (provider) body.whatsappProvider = provider;
      if (apiKey) body.whatsappApiKey = apiKey;
      if (phoneNumberId) body.whatsappPhoneNumberId = phoneNumberId;
      if (webhookSecret) body.whatsappWebhookSecret = webhookSecret;
      if (provider === "evolution") {
        body.evolutionApiBaseUrl = evolutionBaseUrl.trim() || null;
      } else if (provider) {
        body.evolutionApiBaseUrl = null;
      }

      const data = await api.put<AppSettings>("/settings", body);
      setSettings(data);
      setApiKey("");
      setWebhookSecret("");
      setEvolutionBaseUrl(data.evolutionApiBaseUrl ?? "");
    } catch {
      // failed
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.post<{ connected: boolean }>("/settings/test-connection");
      setTestResult(result.connected);
    } catch {
      setTestResult(false);
    } finally {
      setTesting(false);
    }
  };

  const webhookDisplay =
    settings?.webhookUrl ??
    (effectiveOrgId ? `${window.location.origin}/webhooks/whatsapp/${effectiveOrgId}` : "");

  const copyWebhookUrl = () => {
    if (webhookDisplay) {
      navigator.clipboard.writeText(webhookDisplay);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-gray-500">{t("common.adminRequired")}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <PageTransition>
      <div className="p-6 lg:p-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-8 border-b border-gray-200 pb-6">
            <h1 className="text-2xl font-bold text-gray-900">{t("settings.title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">{t("settings.subtitle")}</p>
          </div>

          <div className="flex flex-col gap-8 lg:flex-row lg:gap-10">
            <nav
              className="flex shrink-0 gap-2 overflow-x-auto lg:w-56 lg:flex-col lg:gap-0.5 lg:overflow-visible"
              aria-label="Settings sections"
            >
              {(
                [
                  ["channel", t("settings.sectionChannel"), Smartphone],
                  ["notifications", t("settings.sectionNotifications"), Bell],
                  ["crm", t("settings.sectionCrm"), Tag],
                  ["team", t("settings.sectionTeam"), UserPlus],
                ] as const
              ).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSection(id)}
                  className={clsx(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium whitespace-nowrap transition-colors",
                    section === id
                      ? "bg-white text-brand-800 shadow-sm ring-1 ring-gray-200"
                      : "text-gray-600 hover:bg-white/60 hover:text-gray-900",
                  )}
                >
                  <Icon className="h-5 w-5 shrink-0 text-gray-500" />
                  {label}
                </button>
              ))}
            </nav>

            <motion.div
              className="min-w-0 flex-1 space-y-8"
              variants={staggerContainer}
              initial="hidden"
              animate="show"
            >
              {section === "channel" && (
                <>
                  <motion.div
                    className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                    variants={staggerItem}
                  >
                    <p className="mb-4 text-sm text-gray-600">{t("settings.channelHint")}</p>
                    <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
                      <Settings className="h-5 w-5" />
                      Webhook URL
                    </h2>
                    <p className="mb-3 text-sm text-gray-500">{t("settings.webhookCopyHint")}</p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 overflow-x-auto rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-700">
                        {webhookDisplay || "—"}
                      </code>
                      <button
                        type="button"
                        onClick={copyWebhookUrl}
                        className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-50"
                      >
                        {copied ? (
                          <Check className="h-4 w-4 text-green-500" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </motion.div>

                  <motion.form
                    onSubmit={handleSave}
                    className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                    variants={staggerItem}
                  >
                    <h2 className="mb-4 font-semibold text-gray-900">WhatsApp provider</h2>

                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Provider</label>
                        <select
                          value={provider}
                          onChange={(e) => setProvider(e.target.value)}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="">Select provider...</option>
                          <option value="meta">Meta Cloud API</option>
                          <option value="360dialog">360dialog</option>
                          <option value="twilio">Twilio</option>
                          <option value="evolution">Evolution API</option>
                        </select>
                      </div>

                      {provider === "evolution" && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700">
                            Evolution API base URL
                          </label>
                          <input
                            type="url"
                            value={evolutionBaseUrl}
                            onChange={(e) => setEvolutionBaseUrl(e.target.value)}
                            placeholder="https://evolution.example.com"
                            className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                          />
                          <p className="mt-1 text-xs text-gray-500">
                            Public URL of your Evolution API v2 server (no trailing path; uses REST routes such as{" "}
                            <code className="rounded bg-gray-100 px-1">/message/sendText/…</code>
                            ).
                          </p>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {provider === "evolution" ? "API key" : "API Key"}
                        </label>
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder={settings?.whatsappApiKey ? "••••••••" : "Enter API key"}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                        {provider === "evolution" && (
                          <p className="mt-1 text-xs text-gray-500">
                            Same value as Evolution&apos;s global API key env (often{" "}
                            <code className="rounded bg-gray-100 px-1">AUTHENTICATION_API_KEY</code>); sent as the{" "}
                            <code className="rounded bg-gray-100 px-1">apikey</code> header.
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">
                          {provider === "evolution" ? "Instance name" : "Phone Number ID"}
                        </label>
                        <input
                          type="text"
                          value={phoneNumberId}
                          onChange={(e) => setPhoneNumberId(e.target.value)}
                          placeholder={
                            provider === "evolution"
                              ? "Instance name (as in /instance/create)"
                              : "Enter phone number ID"
                          }
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700">Webhook secret</label>
                        <input
                          type="password"
                          value={webhookSecret}
                          onChange={(e) => setWebhookSecret(e.target.value)}
                          placeholder={
                            provider === "evolution"
                              ? "Optional — leave empty unless you add a custom header on Evolution"
                              : settings?.whatsappWebhookSecret
                                ? "••••••••"
                                : "Enter webhook secret"
                          }
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                        {provider === "evolution" ? (
                          <p className="mt-1 text-xs text-gray-500">
                            <strong>Evolution does not supply this.</strong> Leave it empty for the usual setup —
                            webhooks work without it. For extra verification, invent any long random string, save it
                            here, then in Evolution configure the instance webhook <strong>headers</strong> (e.g. in
                            the webhook JSON or manager UI) with name{" "}
                            <code className="rounded bg-gray-100 px-1">x-openconduit-token</code> and value identical to
                            this field. If this field is filled, requests without that header are rejected with 401.
                          </p>
                        ) : (
                          <p className="mt-1 text-xs text-gray-500">
                            For Meta / 360dialog, use the app verify token / HMAC secret as documented for the Cloud API
                            webhook.
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-3 border-t border-gray-100 pt-4">
                        <input
                          id="autoOptIn"
                          type="checkbox"
                          checked={autoOptIn}
                          onChange={(e) => setAutoOptIn(e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                        />
                        <label htmlFor="autoOptIn" className="text-sm text-gray-700">
                          Auto opt-in contacts when they send the first message
                        </label>
                      </div>
                    </div>

                    <div className="mt-6 flex flex-wrap items-center gap-3">
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                      >
                        {saving ? "Saving..." : "Save channel settings"}
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleTestConnection()}
                        disabled={testing}
                        className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                      >
                        {testing ? (
                          "Testing..."
                        ) : testResult === true ? (
                          <>
                            <Wifi className="h-4 w-4 text-green-500" />
                            Connected
                          </>
                        ) : testResult === false ? (
                          <>
                            <WifiOff className="h-4 w-4 text-red-500" />
                            Failed
                          </>
                        ) : (
                          "Test Connection"
                        )}
                      </button>
                    </div>
                  </motion.form>
                </>
              )}

              {section === "notifications" && (
                <motion.form
                  onSubmit={(e) => void handleSaveNotifications(e)}
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                    <Bell className="h-5 w-5" />
                    {t("settings.sectionNotifications")}
                  </h2>
                  <p className="mb-6 text-sm text-gray-500">
                    Controls the sidebar bell badge and desktop notifications for new inbound WhatsApp activity when
                    conversations are open or pending.
                  </p>
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <input
                        id="notifyOpen"
                        type="checkbox"
                        checked={notifyOpen}
                        onChange={(e) => setNotifyOpen(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <label htmlFor="notifyOpen" className="text-sm text-gray-700">
                        Notify for open conversations
                      </label>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        id="notifyPending"
                        type="checkbox"
                        checked={notifyPending}
                        onChange={(e) => setNotifyPending(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                      />
                      <label htmlFor="notifyPending" className="text-sm text-gray-700">
                        Notify for pending conversations
                      </label>
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={saving}
                    className="mt-6 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                  >
                    {saving ? "Saving..." : "Save notifications"}
                  </button>
                </motion.form>
              )}

              {section === "crm" && (
                <motion.div
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  variants={staggerItem}
                >
                  <h2 className="mb-2 flex items-center gap-2 font-semibold text-gray-900">
                    <Tag className="h-5 w-5" />
                    {t("settings.leadTypesTitle")}
                  </h2>
                  <p className="mb-4 text-sm text-gray-500">{t("settings.leadTypesHint")}</p>
                  {leadTypes.length > 0 && (
                    <ul className="mb-4 divide-y divide-gray-100 rounded-lg border border-gray-100">
                      {leadTypes.map((lt) => (
                        <li
                          key={lt.id}
                          className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
                        >
                          <span className="flex items-center gap-2">
                            <span
                              className="h-3 w-3 rounded-full"
                              style={{ backgroundColor: lt.color }}
                            />
                            {lt.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleDeleteLeadType(lt.id)}
                            className="text-xs font-medium text-red-600 hover:text-red-700"
                          >
                            {t("common.delete")}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {leadTypes.length === 0 && (
                    <p className="mb-4 text-sm text-gray-500">{t("settings.noLeadTypes")}</p>
                  )}
                  <form onSubmit={handleAddLeadType} className="flex flex-wrap items-end gap-3">
                    <div className="min-w-[160px] flex-1">
                      <label className="block text-xs font-medium text-gray-600">
                        {t("settings.leadTypeName")}
                      </label>
                      <input
                        value={newLtName}
                        onChange={(e) => setNewLtName(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600">
                        {t("settings.leadTypeColor")}
                      </label>
                      <input
                        type="color"
                        value={newLtColor}
                        onChange={(e) => setNewLtColor(e.target.value)}
                        className="mt-1 h-9 w-14 cursor-pointer rounded border border-gray-200"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={ltSubmitting || !newLtName.trim()}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {t("settings.addLeadType")}
                    </button>
                  </form>
                  {ltError && <p className="mt-2 text-sm text-red-600">{ltError}</p>}
                  <p className="mt-3 text-xs text-gray-400">{t("settings.saveLeadTypesNote")}</p>
                </motion.div>
              )}

              {section === "team" && (
                <motion.div
                  className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
                  variants={staggerItem}
                >
                  <h2 className="mb-4 flex items-center gap-2 font-semibold text-gray-900">
                    <UserPlus className="h-5 w-5" />
                    Team & users
                  </h2>
                  <p className="mb-4 text-sm text-gray-500">
                    Create accounts for agents or additional admins. Passwords must be at least 8 characters.
                  </p>

                  {teamUsers.length > 0 && (
                    <div className="mb-6 overflow-x-auto rounded-lg border border-gray-100">
                      <table className="w-full min-w-[480px] text-left text-sm">
                        <thead>
                          <tr className="border-b border-gray-100 bg-gray-50 text-xs font-medium uppercase tracking-wide text-gray-500">
                            <th className="px-4 py-2">Name</th>
                            <th className="px-4 py-2">Email</th>
                            <th className="px-4 py-2">Role</th>
                            <th className="px-4 py-2">Added</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {teamUsers.map((u) => (
                            <tr key={u.id} className="bg-white">
                              <td className="px-4 py-2.5 font-medium text-gray-900">{u.name}</td>
                              <td className="px-4 py-2.5 text-gray-600">{u.email}</td>
                              <td className="px-4 py-2.5">
                                <span
                                  className={
                                    u.role === "ADMIN"
                                      ? "rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"
                                      : "rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700"
                                  }
                                >
                                  {u.role === "ADMIN" ? "Admin" : "Agent"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-gray-500">
                                {new Date(u.createdAt).toLocaleDateString(undefined, {
                                  year: "numeric",
                                  month: "short",
                                  day: "numeric",
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <form onSubmit={handleAddUser} className="space-y-4">
                    {userFormError && (
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{userFormError}</p>
                    )}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">Name</label>
                        <input
                          type="text"
                          value={newUserName}
                          onChange={(e) => setNewUserName(e.target.value)}
                          required
                          autoComplete="name"
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Email</label>
                        <input
                          type="email"
                          value={newUserEmail}
                          onChange={(e) => setNewUserEmail(e.target.value)}
                          required
                          autoComplete="email"
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Role</label>
                        <select
                          value={newUserRole}
                          onChange={(e) => setNewUserRole(e.target.value as "ADMIN" | "AGENT")}
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        >
                          <option value="AGENT">Agent</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-sm font-medium text-gray-700">Initial password</label>
                        <input
                          type="password"
                          value={newUserPassword}
                          onChange={(e) => setNewUserPassword(e.target.value)}
                          required
                          minLength={8}
                          autoComplete="new-password"
                          placeholder="At least 8 characters"
                          className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={userFormSubmitting}
                      className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50"
                    >
                      {userFormSubmitting ? "Adding…" : "Add user"}
                    </button>
                  </form>
                </motion.div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </PageTransition>
  );
}
