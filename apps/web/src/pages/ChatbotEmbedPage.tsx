import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Send } from "lucide-react";

interface ChatbotTheme {
  primaryColor?: string;
  backgroundColor?: string;
  botBubbleColor?: string;
  guestBubbleColor?: string;
  fontFamily?: string;
  borderRadius?: number;
  headerTitle?: string;
}

interface PublicFlowInfo {
  name: string;
  description: string | null;
  theme: ChatbotTheme;
}

interface SimulatorSession {
  currentNodeId: string | null;
  variables: Record<string, string>;
  status: string;
  waitingInput: unknown;
}

const API = "/api/v1/public/chatbot";

export function ChatbotEmbedPage() {
  const { publicId } = useParams<{ publicId: string }>();
  const [info, setInfo] = useState<PublicFlowInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<{ role: "bot" | "user"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [session, setSession] = useState<SimulatorSession | null>(null);
  const [completed, setCompleted] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const booted = useRef(false);

  const theme = info?.theme ?? {};

  useEffect(() => {
    if (!publicId) return;
    setLoading(true);
    fetch(`${API}/${encodeURIComponent(publicId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("not_found");
        return res.json() as Promise<PublicFlowInfo & { theme: ChatbotTheme }>;
      })
      .then((data) => {
        setInfo({ name: data.name, description: data.description, theme: data.theme });
        setError(null);
      })
      .catch(() => setError("not_found"))
      .finally(() => setLoading(false));
  }, [publicId]);

  const sendTurn = useCallback(
    async (text: string, reset?: boolean) => {
      if (!publicId || sending) return;
      setSending(true);
      try {
        const res = await fetch(`${API}/${encodeURIComponent(publicId)}/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            reset: reset ?? false,
            session: reset ? undefined : session ?? undefined,
          }),
        });
        if (!res.ok) throw new Error("chat_failed");
        const data = (await res.json()) as {
          messages: string[];
          session: SimulatorSession;
          completed: boolean;
        };
        if (text.trim()) {
          setMessages((m) => [...m, { role: "user", text: text.trim() }]);
        }
        for (const msg of data.messages) {
          if (msg.trim()) setMessages((m) => [...m, { role: "bot", text: msg }]);
        }
        setSession(data.session);
        setCompleted(data.completed);
      } catch {
        setError("chat_failed");
      } finally {
        setSending(false);
      }
    },
    [publicId, sending, session],
  );

  useEffect(() => {
    if (!info || booted.current || error) return;
    booted.current = true;
    void sendTurn("", true);
  }, [info, error, sendTurn]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = input.trim();
    if (!t || completed) return;
    setInput("");
    void sendTurn(t);
  };

  const radius = theme.borderRadius ?? 16;
  const primary = theme.primaryColor ?? "#ff6b2c";
  const bg = theme.backgroundColor ?? "#f4f5f7";

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: bg }}>
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: primary }} />
      </div>
    );
  }

  if (error === "not_found" || !info) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center" style={{ background: bg }}>
        <p className="text-sm text-ink-600">Chatbot não disponível ou não publicado.</p>
      </div>
    );
  }

  const title = theme.headerTitle?.trim() || info.name;

  return (
    <div
      className="flex min-h-screen flex-col"
      style={{ background: bg, fontFamily: theme.fontFamily ?? "system-ui, sans-serif" }}
    >
      <header
        className="shrink-0 px-4 py-3 text-white shadow-sm"
        style={{ background: primary }}
      >
        <h1 className="text-sm font-bold">{title}</h1>
        {info.description ? <p className="mt-0.5 text-[11px] opacity-90">{info.description}</p> : null}
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex max-w-lg flex-col gap-2">
          {messages.map((m, i) => (
            <div
              key={`${i}-${m.text.slice(0, 12)}`}
              className={`max-w-[85%] whitespace-pre-wrap px-3 py-2 text-sm shadow-sm ${
                m.role === "user" ? "ml-auto" : "mr-auto"
              }`}
              style={{
                borderRadius: radius,
                background: m.role === "user" ? (theme.guestBubbleColor ?? "#fff4ed") : (theme.botBubbleColor ?? "#fff"),
              }}
            >
              {m.text}
            </div>
          ))}
          {completed ? (
            <p className="py-2 text-center text-xs text-ink-500">Conversa concluída.</p>
          ) : null}
          <div ref={bottomRef} />
        </div>
      </div>

      <form
        onSubmit={onSubmit}
        className="shrink-0 border-t border-black/5 bg-white/80 p-3 backdrop-blur dark:bg-ink-900/80"
      >
        <div className="mx-auto flex max-w-lg gap-2">
          <input
            className="min-w-0 flex-1 rounded-xl border border-ink-200 px-3 py-2 text-sm dark:border-ink-700 dark:bg-ink-900"
            style={{ borderRadius: Math.min(radius, 12) }}
            placeholder={completed ? "—" : "Escreva aqui…"}
            value={input}
            disabled={completed || sending}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            disabled={completed || sending || !input.trim()}
            className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-white disabled:opacity-40"
            style={{ background: primary, borderRadius: Math.min(radius, 12) }}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}
