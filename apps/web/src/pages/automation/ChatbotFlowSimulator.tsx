import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Loader2, MessageCircle, RotateCcw, Send } from "lucide-react";
import { useI18n } from "@/i18n/I18nProvider";
import { api } from "@/lib/api";

interface SimulatorSession {
  currentNodeId: string | null;
  variables: Record<string, string>;
  status: string;
  waitingInput: Record<string, unknown> | null;
}

interface ChatLine {
  role: "bot" | "user";
  text: string;
}

interface Props {
  flowId: string;
  disabled?: boolean;
}

export function ChatbotFlowSimulator({ flowId, disabled }: Props) {
  const { t } = useI18n();
  const [lines, setLines] = useState<ChatLine[]>([]);
  const [input, setInput] = useState("");
  const [session, setSession] = useState<SimulatorSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const bootedRef = useRef(false);

  const runTurn = useCallback(
    async (message: string, reset: boolean) => {
      setBusy(true);
      try {
        const res = await api.post<{
          messages: string[];
          session: SimulatorSession;
          completed: boolean;
        }>(`/automation/chatbot-flows/${flowId}/test-chat`, {
          message,
          reset,
          session: reset ? undefined : session ?? undefined,
        });
        const botLines = (res.messages ?? []).map((text) => ({ role: "bot" as const, text }));
        setLines((prev) => (reset ? botLines : [...prev, ...botLines]));
        setSession(res.session);
        setCompleted(Boolean(res.completed));
      } catch {
        setLines((prev) => [
          ...prev,
          { role: "bot", text: t("chatbotPage.simulatorError") },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [flowId, session, t],
  );

  useEffect(() => {
    if (!flowId || bootedRef.current || disabled) return;
    bootedRef.current = true;
    void runTurn("", true);
  }, [flowId, disabled, runTurn]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [lines]);

  const onSend = async () => {
    const text = input.trim();
    if (!text || busy || disabled) return;
    setLines((prev) => [...prev, { role: "user", text }]);
    setInput("");
    await runTurn(text, false);
  };

  const onReset = () => {
    setLines([]);
    setSession(null);
    setCompleted(false);
    bootedRef.current = false;
    void runTurn("", true);
    bootedRef.current = true;
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900/60">
      <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3 dark:border-ink-800">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-ink-900 dark:text-ink-50">
          <MessageCircle className="h-4 w-4 text-brand-500" />
          {t("chatbotPage.simulatorTitle")}
        </h3>
        <button
          type="button"
          disabled={busy || disabled}
          onClick={onReset}
          className="inline-flex items-center gap-1 rounded-lg border border-ink-200 px-2 py-1 text-[11px] font-medium text-ink-600 hover:bg-ink-50 dark:border-ink-700 dark:text-ink-300"
        >
          <RotateCcw className="h-3 w-3" />
          {t("chatbotPage.simulatorReset")}
        </button>
      </div>
      <div
        ref={scrollRef}
        className="h-56 overflow-y-auto bg-ink-50/80 p-3 dark:bg-ink-950/40"
      >
        {lines.length === 0 && !busy ? (
          <p className="text-center text-xs text-ink-500">{t("chatbotPage.simulatorEmpty")}</p>
        ) : null}
        <div className="space-y-2">
          {lines.map((line, i) => (
            <div
              key={`${i}-${line.role}`}
              className={clsx(
                "max-w-[85%] rounded-2xl px-3 py-2 text-xs",
                line.role === "user"
                  ? "ml-auto bg-brand-600 text-white"
                  : "mr-auto border border-ink-200 bg-white text-ink-800 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100",
              )}
            >
              <pre className="whitespace-pre-wrap font-sans">{line.text}</pre>
            </div>
          ))}
          {busy ? (
            <div className="flex items-center gap-2 text-xs text-ink-500">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("chatbotPage.simulatorThinking")}
            </div>
          ) : null}
        </div>
      </div>
      {completed ? (
        <p className="border-t border-ink-100 px-4 py-2 text-[11px] text-emerald-600 dark:border-ink-800">
          {t("chatbotPage.simulatorCompleted")}
        </p>
      ) : null}
      <div className="flex gap-2 border-t border-ink-100 p-3 dark:border-ink-800">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void onSend();
            }
          }}
          disabled={busy || disabled || completed}
          placeholder={t("chatbotPage.simulatorPlaceholder")}
          className="min-w-0 flex-1 rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-800"
        />
        <button
          type="button"
          disabled={busy || disabled || completed || !input.trim()}
          onClick={() => void onSend()}
          className="inline-flex items-center gap-1 rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-500 disabled:opacity-50"
        >
          <Send className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
