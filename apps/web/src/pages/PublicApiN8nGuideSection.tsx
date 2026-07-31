import { DocCodeBlock } from "@/pages/publicApiDocsShared";
import { N8nWorkflowAnimation } from "@/pages/N8nWorkflowAnimation";

export type PublicApiDocGuideSection = {
  id: string;
  titlePt: string;
  bodyPt?: string;
  codeLabelPt?: string;
  codePt?: string;
  bulletsPt?: string[];
};

export type PublicApiDocN8nGuide = {
  titlePt: string;
  introPt: string;
  sequenceDiagramMermaid: string;
  sections: PublicApiDocGuideSection[];
};

type Props = {
  guide: PublicApiDocN8nGuide;
  diagramCaption: string;
  endpointLinks?: { label: string; href: string }[];
};

export function PublicApiN8nGuideSection({ guide, diagramCaption, endpointLinks }: Props) {
  return (
    <section
      id="guia-n8n"
      className="scroll-mt-24 rounded-lg border border-orange-200/80 bg-gradient-to-br from-orange-50/90 via-white to-white p-5 shadow-md dark:border-orange-900/50 dark:from-orange-950/25 dark:to-ink-900/60 print:break-inside-avoid"
    >
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="https://n8n.io"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2.5 rounded-lg border border-ink-200/80 bg-white px-3 py-2 shadow-sm transition hover:border-[#EA4B71]/40 hover:shadow-md dark:border-ink-700 dark:bg-ink-900/80"
              title="n8n — workflow automation"
            >
              <img src="/n8n-logo-icon.svg" alt="" width={28} height={23} className="shrink-0" aria-hidden />
              <img src="/n8n-logo-text.svg" alt="n8n" width={52} height={26} className="shrink-0 dark:brightness-200" />
            </a>
            <span className="text-xs font-medium text-ink-400 dark:text-ink-500">× OpenNexo CRM</span>
          </div>

          <h2 className="mt-4 text-xl font-bold tracking-tight text-ink-900 dark:text-white">{guide.titlePt}</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-700 dark:text-ink-300">{guide.introPt}</p>

          {endpointLinks?.length ? (
            <p className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-500">
              {endpointLinks.map((link) => (
                <a key={link.href} className="text-brand-600 underline hover:text-brand-700 dark:text-brand-400" href={link.href}>
                  {link.label}
                </a>
              ))}
            </p>
          ) : null}
        </div>

        <N8nWorkflowAnimation />
      </div>

      <div className="mt-8">
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink-500">{diagramCaption}</h3>
        <div className="mt-2">
          <DocCodeBlock>{guide.sequenceDiagramMermaid}</DocCodeBlock>
        </div>
        <p className="mt-2 text-[11px] text-ink-500">
          Visualize em{" "}
          <a href="https://mermaid.live" target="_blank" rel="noopener noreferrer" className="text-brand-600 underline">
            mermaid.live
          </a>{" "}
          colando o diagrama acima.
        </p>
      </div>

      <div className="mt-8 space-y-8">
        {guide.sections.map((sec) => (
          <article key={sec.id} id={`n8n-${sec.id}`} className="scroll-mt-24 border-t border-ink-200/80 pt-6 first:border-t-0 first:pt-0 dark:border-ink-700/80">
            <h3 className="text-base font-bold text-ink-900 dark:text-ink-50">{sec.titlePt}</h3>
            {sec.bodyPt ? (
              <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-700 dark:text-ink-300">{sec.bodyPt}</p>
            ) : null}
            {sec.bulletsPt?.length ? (
              <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-ink-700 dark:text-ink-300">
                {sec.bulletsPt.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            ) : null}
            {sec.codePt ? (
              <div className="mt-4">
                {sec.codeLabelPt ? (
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-ink-500">{sec.codeLabelPt}</p>
                ) : null}
                <DocCodeBlock>{sec.codePt}</DocCodeBlock>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
