import { useState, useEffect, type FormEvent } from "react";
import { useNavigate, Navigate, Link } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { motion, AnimatePresence } from "@/components/Motion";
import { isSuperAdminRole } from "@/lib/authRole";
import { api } from "@/lib/api";
import { BrandLogo } from "@/components/BrandLogo";
import { brandAssetUrl } from "@/lib/brandingAssets";

const REMEMBER_EMAIL_KEY = "opennexo_login_email";

export function LoginPage() {
  const { user, login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "forgot">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(REMEMBER_EMAIL_KEY);
      if (stored) {
        setEmail(stored);
        setRememberMe(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

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

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    try {
      if (rememberMe) {
        try {
          localStorage.setItem(REMEMBER_EMAIL_KEY, trimmedEmail);
        } catch {
          /* ignore */
        }
      } else {
        try {
          localStorage.removeItem(REMEMBER_EMAIL_KEY);
        } catch {
          /* ignore */
        }
      }
      const u = await login(trimmedEmail, trimmedPassword);
      navigate(isSuperAdminRole(u.role) && !u.actingOrganizationId ? "/super" : "/");
    } catch (err) {
      if (err instanceof Error) {
        setError(err.message);
      } else {
        setError(t("login.errorGeneric"));
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setForgotSent(false);
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email: email.trim().toLowerCase() });
      setForgotSent(true);
    } catch {
      setError(t("login.errorGeneric"));
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
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-8 text-center">
            <motion.div
              className="mx-auto mb-5 flex justify-center"
              initial={{ opacity: 0, scale: 0.92 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.35, delay: 0.05 }}
            >
              <BrandLogo alt="Logo" className="h-14 max-w-[200px]" />
            </motion.div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-900 dark:text-ink-50">
              {mode === "login" ? t("login.title") : t("login.forgotTitle")}
            </h1>
            <p className="mt-1.5 text-sm text-ink-500 dark:text-ink-400">
              {mode === "login" ? t("login.subtitle") : t("login.forgotSubtitle")}
            </p>
          </div>

          {mode === "login" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2 }}
                    className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("login.email")}
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field mt-1.5 rounded-lg border-ink-200 dark:border-ink-600"
                  placeholder={t("login.emailPlaceholder")}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("login.password")}
                </label>
                <div className="relative mt-1.5">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input-field w-full rounded-lg border-ink-200 pr-11 dark:border-ink-600"
                    placeholder={t("login.passwordPlaceholder")}
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1.5 text-ink-500 hover:bg-ink-100 hover:text-ink-700 dark:hover:bg-ink-800"
                    aria-label={showPassword ? t("login.hidePassword") : t("login.showPassword")}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-ink-700 dark:text-ink-200">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="rounded border-ink-300 text-indigo-600 focus:ring-indigo-500 dark:border-ink-600"
                  />
                  {t("login.rememberMe")}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMode("forgot");
                    setError("");
                    setForgotSent(false);
                  }}
                  className="font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300"
                >
                  {t("login.forgotPassword")}
                </button>
              </div>

              <motion.button
                type="submit"
                disabled={loading}
                className="btn-primary w-full rounded-lg bg-indigo-600 py-2.5 text-white hover:bg-indigo-700 focus-visible:ring-indigo-500 dark:bg-indigo-500 dark:hover:bg-indigo-600"
                whileTap={{ scale: 0.99 }}
              >
                {loading ? t("common.loading") : t("login.submit")}
              </motion.button>

              <p className="pt-2 text-center text-sm text-ink-600 dark:text-ink-400">
                {t("login.noAccountPrefix")}{" "}
                <span className="font-medium text-indigo-600 dark:text-indigo-400">{t("login.contactAdmin")}</span>
              </p>
            </form>
          ) : (
            <form onSubmit={handleForgot} className="space-y-4">
              <AnimatePresence>
                {error && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200"
                  >
                    {error}
                  </motion.div>
                )}
              </AnimatePresence>
              {forgotSent ? (
                <p className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-100">
                  {t("login.forgotSent")}
                </p>
              ) : null}
              <div>
                <label htmlFor="forgot-email" className="block text-sm font-medium text-ink-700 dark:text-ink-200">
                  {t("login.email")}
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field mt-1.5 rounded-lg border-ink-200 dark:border-ink-600"
                  placeholder={t("login.emailPlaceholder")}
                />
              </div>
              <motion.button
                type="submit"
                disabled={loading}
                className="btn-primary w-full rounded-lg bg-indigo-600 py-2.5 text-white hover:bg-indigo-700 dark:bg-indigo-500"
                whileTap={{ scale: 0.99 }}
              >
                {loading ? t("common.loading") : t("login.forgotSubmit")}
              </motion.button>
              <button
                type="button"
                onClick={() => {
                  setMode("login");
                  setError("");
                  setForgotSent(false);
                }}
                className="w-full text-center text-sm font-medium text-indigo-600 hover:text-indigo-700 dark:text-indigo-400"
              >
                {t("login.forgotBack")}
              </button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
