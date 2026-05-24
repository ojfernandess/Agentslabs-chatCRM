import { useState, type FormEvent, useMemo, useEffect } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { motion } from "@/components/Motion";
import { isSuperAdminRole } from "@/lib/authRole";
import { api, ApiError } from "@/lib/api";
import { brandAssetUrl } from "@/lib/brandingAssets";

export function AcceptInvitePage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);

  const [inviteLoading, setInviteLoading] = useState(true);
  const [inviteError, setInviteError] = useState("");
  const [email, setEmail] = useState("");
  const [organizationName, setOrganizationName] = useState("");

  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void api
      .get<{ email: string; organizationName: string }>(`/auth/invite?token=${encodeURIComponent(token)}`)
      .then((res) => {
        if (cancelled) return;
        setEmail(res.email);
        setOrganizationName(res.organizationName);
      })
      .catch(() => {
        if (!cancelled) setInviteError(t("login.inviteTokenInvalid"));
      })
      .finally(() => {
        if (!cancelled) setInviteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, t]);

  if (user) {
    if (user.superAdminActorId) {
      return <Navigate to="/" replace />;
    }
    return (
      <Navigate
        to={isSuperAdminRole(user.role) && !user.actingOrganizationId ? "/super" : "/"}
        replace
      />
    );
  }

  if (!token) {
    return <Navigate to="/login" replace />;
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError(t("login.resetMismatch"));
      return;
    }
    setLoading(true);
    try {
      await api.post("/auth/accept-invite", { token, name: name.trim(), password });
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || t("login.inviteAcceptError"));
      } else {
        setError(t("login.inviteAcceptError"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col lg:flex-row">
      <div
        className="relative min-h-[220px] flex-1 bg-ink-800 bg-cover bg-center lg:min-h-screen"
        style={{ backgroundImage: `url(${brandAssetUrl("/bg-login.png")})` }}
      >
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-black/10 lg:bg-gradient-to-r" />
      </div>
      <div className="relative z-10 flex w-full max-w-xl flex-1 items-center justify-center bg-ink-50 px-4 py-10 lg:max-w-none lg:bg-transparent lg:px-10 lg:py-12">
        <motion.div
          className="w-full max-w-md rounded-2xl border border-ink-100 bg-white p-8 shadow-xl dark:border-ink-700 dark:bg-ink-900"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="mb-8 text-center">
            <img src={brandAssetUrl("/logo.svg")} alt="" className="mx-auto mb-4 h-12" />
            <h1 className="text-xl font-bold text-ink-900 dark:text-ink-50">{t("login.inviteTitle")}</h1>
            {organizationName ? (
              <p className="mt-2 text-sm text-ink-500">{t("login.inviteOrg").replace("{name}", organizationName)}</p>
            ) : null}
          </div>

          {inviteLoading ? (
            <p className="text-center text-sm text-ink-500">{t("common.loading")}</p>
          ) : inviteError ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{inviteError}</p>
          ) : done ? (
            <p className="text-center text-sm text-green-700">{t("login.inviteDone")}</p>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              {error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">Email</label>
                <input type="email" value={email} readOnly className="mt-1 block w-full input-field bg-ink-50" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("login.inviteName")}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                  className="mt-1 block w-full input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("login.invitePassword")}</label>
                <div className="relative mt-1">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    className="block w-full input-field pr-10"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-400"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? "Hide" : "Show"}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">{t("login.inviteConfirm")}</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  className="mt-1 block w-full input-field"
                />
              </div>
              <button type="submit" className="btn-primary w-full" disabled={loading}>
                {loading ? t("common.saving") : t("login.inviteSubmit")}
              </button>
            </form>
          )}

          <p className="mt-6 text-center text-sm text-ink-500">
            <Link to="/login" className="font-medium text-brand-600 hover:underline">
              {t("login.backToLogin")}
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
