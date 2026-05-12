import { useState, type FormEvent, useMemo } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { motion, AnimatePresence } from "@/components/Motion";
import { isSuperAdminRole } from "@/lib/authRole";
import { api, ApiError } from "@/lib/api";
import { brandAssetUrl } from "@/lib/brandingAssets";

export function ResetPasswordPage() {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

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
      await api.post("/auth/reset-password", { token, newPassword: password });
      setDone(true);
      setTimeout(() => navigate("/login", { replace: true }), 2000);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || t("login.resetTokenInvalid"));
      } else {
        setError(t("login.resetTokenInvalid"));
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
            <img src={brandAssetUrl("/logo.svg")} alt="OpenNexo CRM" className="mx-auto mb-5 h-14 w-auto" />
            <h1 className="text-2xl font-bold text-ink-900 dark:text-ink-50">{t("login.resetTitle")}</h1>
            <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400">{t("login.resetSubtitle")}</p>
          </div>

          {done ? (
            <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-center text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-100">
              {t("login.resetSuccess")}
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
              <div>
                <label htmlFor="np" className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("login.newPassword")}
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="np"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={8}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field w-full rounded-lg border-ink-200 pr-11 dark:border-ink-600"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-500 hover:bg-ink-100 dark:hover:bg-ink-800"
                    aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="npc" className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("login.newPasswordConfirm")}
                </label>
                <input
                  id="npc"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="input-field mt-1.5 rounded-lg border-ink-200 dark:border-ink-600"
                />
              </div>
              <motion.button
                type="submit"
                disabled={loading}
                className="btn-primary w-full rounded-lg bg-indigo-600 py-2.5 text-white hover:bg-indigo-700 dark:bg-indigo-500"
                whileTap={{ scale: 0.99 }}
              >
                {loading ? t("common.loading") : t("login.resetSubmit")}
              </motion.button>
            </form>
          )}

          <p className="mt-6 text-center text-sm">
            <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400">
              {t("login.resetBack")}
            </Link>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
