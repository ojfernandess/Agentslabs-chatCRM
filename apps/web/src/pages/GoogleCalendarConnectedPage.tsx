import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, XCircle } from "lucide-react";

export function GoogleCalendarConnectedPage() {
  const [params] = useSearchParams();
  const ok = params.get("googleCalendarOAuth") === "success";
  const message = params.get("message");

  const title = useMemo(
    () => (ok ? "Agenda Google ligada" : "Não foi possível ligar a agenda"),
    [ok],
  );

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-50 px-4 dark:bg-ink-950">
      <div className="w-full max-w-md rounded-2xl border border-ink-200 bg-white p-6 shadow-sm dark:border-ink-700 dark:bg-ink-900">
        <div className="flex items-start gap-3">
          {ok ? (
            <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
          ) : (
            <XCircle className="mt-0.5 h-6 w-6 shrink-0 text-red-500" />
          )}
          <div>
            <h1 className="text-lg font-semibold text-ink-900 dark:text-ink-50">{title}</h1>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-300">
              {ok
                ? "A sua conta Google Calendar foi sincronizada. O agente já pode marcar eventos nas agendas autorizadas."
                : message || "Ocorreu um erro durante a autorização. Peça um novo link ao administrador."}
            </p>
          </div>
        </div>
        <p className="mt-5 text-xs text-ink-500">Pode fechar esta página.</p>
        <Link to="/login" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
          Ir para o painel
        </Link>
      </div>
    </div>
  );
}
