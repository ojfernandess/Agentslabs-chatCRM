import type { HelpArticle } from "./types";
import { HELP_ARTICLES } from "./articles";
import { isArticleVisible, type HelpFilterContext } from "./search";

/** Longest-prefix match for contextual help */
const ROUTE_RULES: { prefix: string; slugs: string[] }[] = [
  { prefix: "/broadcasts", slugs: ["campaigns/overview", "campaigns/create", "campaigns/follow-up"] },
  { prefix: "/bots", slugs: ["bots/overview", "bots/create", "bots/webhooks"] },
  { prefix: "/automation", slugs: ["automation/overview", "automation/knowledge-base", "automation/agent-profiles"] },
  { prefix: "/deals", slugs: ["deals/overview", "deals/create", "deals/status"] },
  { prefix: "/crm", slugs: ["crm/overview", "crm/configure"] },
  { prefix: "/conversations", slugs: ["conversations/overview", "conversations/assign-close"] },
  { prefix: "/contacts", slugs: ["contacts/overview", "contacts/tags"] },
  { prefix: "/settings", slugs: ["settings/overview", "settings/channel", "settings/team"] },
  { prefix: "/inboxes", slugs: ["settings/inboxes", "conversations/overview"] },
  { prefix: "/teams", slugs: ["teams/overview"] },
  { prefix: "/reports", slugs: ["analytics/dashboard"] },
  { prefix: "/ai-insights", slugs: ["analytics/ai-insights"] },
  { prefix: "/reminders", slugs: ["automation/reminders"] },
  { prefix: "/", slugs: ["getting-started/platform-overview", "analytics/dashboard"] },
];

export function getContextualArticles(pathname: string, ctx: HelpFilterContext): HelpArticle[] {
  const path = pathname.split("?")[0] ?? "/";
  const rule =
    ROUTE_RULES.filter((r) => path === r.prefix || (r.prefix !== "/" && path.startsWith(r.prefix))).sort(
      (a, b) => b.prefix.length - a.prefix.length,
    )[0] ?? ROUTE_RULES.find((r) => r.prefix === "/");

  if (!rule) return [];

  const articles: HelpArticle[] = [];
  for (const slug of rule.slugs) {
    const article = HELP_ARTICLES.find((a) => a.slug === slug);
    if (article && isArticleVisible(article, ctx)) {
      articles.push(article);
    }
  }
  return articles;
}

export function getContextLabel(pathname: string): string | null {
  const path = pathname.split("?")[0] ?? "/";
  if (path.startsWith("/deals")) return "Negócios";
  if (path.startsWith("/broadcasts")) return "Campanhas";
  if (path.startsWith("/bots")) return "Bots";
  if (path.startsWith("/automation")) return "Automação";
  if (path.startsWith("/crm")) return "CRM";
  if (path.startsWith("/conversations")) return "Conversas";
  if (path.startsWith("/contacts")) return "Contatos";
  if (path.startsWith("/settings")) return "Configurações";
  return null;
}
