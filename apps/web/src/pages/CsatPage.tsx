import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useI18n } from "@/i18n/I18nProvider";
import clsx from "clsx";
import { Star } from "lucide-react";

const CSAT_EMOJIS: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: "😡",
  2: "😕",
  3: "😐",
  4: "🙂",
  5: "😍",
};

type CsatRatingType = "number" | "star" | "emoji";

type CsatGetOk =
  | {
      organizationName: string;
      introText: string;
      ratingType: CsatRatingType;
      alreadySubmitted: true;
      score: number;
      comment: string | null;
    }
  | {
      organizationName: string;
      introText: string;
      ratingType: CsatRatingType;
      alreadySubmitted: false;
    };

function CsatScoreDisplay({ score, ratingType }: { score: number; ratingType: CsatRatingType }) {
  if (ratingType === "emoji") {
    return (
      <span className="text-4xl" aria-label={String(score)}>
        {CSAT_EMOJIS[score as 1 | 2 | 3 | 4 | 5] ?? score}
      </span>
    );
  }
  if (ratingType === "star") {
    return (
      <CsatStarPicker score={score} interactive={false} onSelect={() => {}} />
    );
  }
  return <span className="text-2xl font-bold text-amber-600">{score}</span>;
}

function CsatStarPicker({
  score,
  interactive,
  onSelect,
}: {
  score: number | null;
  interactive: boolean;
  onSelect: (n: number) => void;
}) {
  return (
    <div className="flex justify-center gap-1">
      {([1, 2, 3, 4, 5] as const).map((i) => (
        <button
          key={i}
          type="button"
          disabled={!interactive}
          onClick={interactive ? () => onSelect(score === i ? 0 : i) : undefined}
          className={clsx(
            interactive && "rounded-lg p-1 transition-transform hover:scale-110",
            !interactive && "pointer-events-none",
          )}
        >
          <Star
            className={clsx(
              "h-8 w-8",
              score != null && i <= score
                ? "fill-amber-400 text-amber-400"
                : "text-ink-300 dark:text-ink-600",
            )}
          />
        </button>
      ))}
    </div>
  );
}

function CsatRatingPicker({
  ratingType,
  score,
  onSelect,
  rateLabel,
}: {
  ratingType: CsatRatingType;
  score: number | null;
  onSelect: (n: number | null) => void;
  rateLabel: string;
}) {
  return (
    <div>
      <p className="text-sm font-medium text-ink-700 dark:text-ink-300">{rateLabel}</p>
      {ratingType === "emoji" ? (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {([1, 2, 3, 4, 5] as const).map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onSelect(score === n ? null : n)}
              className={clsx(
                "flex h-14 w-14 items-center justify-center rounded-xl border text-3xl transition-colors",
                score === n
                  ? "border-amber-400 bg-amber-100 dark:border-amber-500 dark:bg-amber-950/40"
                  : "border-ink-200 bg-white hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:hover:bg-ink-700",
              )}
              title={String(n)}
            >
              {CSAT_EMOJIS[n]}
            </button>
          ))}
        </div>
      ) : ratingType === "star" ? (
        <div className="mt-3">
          <CsatStarPicker
            score={score}
            interactive
            onSelect={(n: number) => onSelect(n === 0 ? null : n)}
          />
        </div>
      ) : (
        <CsatNumberPicker score={score} onSelect={onSelect} />
      )}
    </div>
  );
}

function CsatNumberPicker({
  score,
  onSelect,
}: {
  score: number | null;
  onSelect: (n: number | null) => void;
}) {
  return (
    <div className="mt-2 flex flex-wrap justify-center gap-1.5">
      {([1, 2, 3, 4, 5] as const).map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onSelect(score === n ? null : n)}
          className={clsx(
            "flex h-10 min-w-[2.5rem] items-center justify-center rounded-lg border text-sm font-semibold transition-colors",
            score === n
              ? "border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-100"
              : "border-ink-200 bg-white text-ink-700 hover:bg-ink-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-200 dark:hover:bg-ink-700",
          )}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

export function CsatPage() {
  const { token: rawToken } = useParams<{ token: string }>();
  const token = rawToken?.trim() ?? "";
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CsatGetOk | null>(null);
  const [score, setScore] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [submittedScore, setSubmittedScore] = useState<number | null>(null);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      setError("bad_link");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/v1/public/csat/${encodeURIComponent(token)}`);
        if (!res.ok) {
          if (!cancelled) {
            setError(res.status === 410 ? "gone" : "bad_link");
            setData(null);
          }
          return;
        }
        const json = (await res.json()) as CsatGetOk;
        if (!cancelled) {
          setData(json);
          if (json.alreadySubmitted) {
            setDone(true);
            setSubmittedScore(json.score);
          }
          setError(null);
        }
      } catch {
        if (!cancelled) setError("bad_link");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token || score == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/public/csat/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score,
          comment: comment.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message?.includes?.("Gone") ? "gone" : "bad_link");
        return;
      }
      const json = (await res.json()) as { score: number };
      setDone(true);
      setSubmittedScore(json.score);
    } catch {
      setError("bad_link");
    } finally {
      setSubmitting(false);
    }
  };

  const errMsg =
    error === "gone"
      ? t("csatPage.errorGone")
      : error === "bad_link"
        ? t("csatPage.errorBadLink")
        : null;

  const ratingType = data?.ratingType ?? "number";
  const rateLabel =
    ratingType === "emoji"
      ? t("csatPage.rateLabelEmoji")
      : ratingType === "star"
        ? t("csatPage.rateLabelStar")
        : t("csatPage.rateLabel");

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50/90 to-ink-100/90 px-4 py-10 dark:from-ink-950 dark:to-ink-900">
      <div className="mx-auto max-w-md rounded-2xl border border-ink-200/80 bg-white/95 p-6 shadow-lg dark:border-ink-700 dark:bg-ink-900/95">
        <h1 className="text-center text-lg font-semibold text-ink-900 dark:text-ink-50">
          {t("csatPage.title")}
        </h1>
        {loading ? (
          <p className="mt-6 text-center text-sm text-ink-500">{t("common.loading")}</p>
        ) : errMsg && !data ? (
          <p className="mt-6 text-center text-sm text-amber-800 dark:text-amber-200">{errMsg}</p>
        ) : data && done ? (
          <div className="mt-6 text-center">
            <p className="text-sm font-medium text-ink-800 dark:text-ink-200">{data.organizationName}</p>
            <p className="mt-4 text-sm text-ink-600 dark:text-ink-400">{t("csatPage.thankYou")}</p>
            {submittedScore != null ? (
              <div className="mt-3 flex justify-center">
                <CsatScoreDisplay score={submittedScore} ratingType={data.ratingType} />
              </div>
            ) : null}
          </div>
        ) : data && !data.alreadySubmitted ? (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <p className="text-center text-sm font-medium text-ink-800 dark:text-ink-200">{data.organizationName}</p>
            <p className="text-sm text-ink-600 dark:text-ink-400">{data.introText}</p>
            <CsatRatingPicker
              ratingType={data.ratingType}
              score={score}
              onSelect={setScore}
              rateLabel={rateLabel}
            />
            <div>
              <label className="block text-sm font-medium text-ink-700 dark:text-ink-300">
                {t("csatPage.commentLabel")}
              </label>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                disabled={score == null}
                className="mt-1 block w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:opacity-50 dark:border-ink-600 dark:bg-ink-800 dark:text-ink-100"
                placeholder={t("csatPage.commentPlaceholder")}
              />
            </div>
            {errMsg ? <p className="text-sm text-red-600 dark:text-red-400">{errMsg}</p> : null}
            <button
              type="submit"
              disabled={submitting || score == null}
              className="w-full rounded-lg bg-brand-500 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-500"
            >
              {t("csatPage.submit")}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
