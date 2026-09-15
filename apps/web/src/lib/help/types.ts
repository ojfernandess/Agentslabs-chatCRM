export type HelpArticleLevel = "basic" | "intermediate" | "advanced";

export type HelpCalloutVariant = "tip" | "important" | "admin" | "example" | "info";

export type HelpArticleBlock =
  | { type: "heading"; id?: string; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered?: boolean; items: string[] }
  | { type: "steps"; steps: { title: string; body?: string }[] }
  | { type: "callout"; variant: HelpCalloutVariant; title?: string; text: string }
  | { type: "link"; href: string; text: string; external?: boolean };

export interface HelpArticle {
  id: string;
  /** Path segment after /help/ — e.g. "bots/create" */
  slug: string;
  title: string;
  description: string;
  categoryId: string;
  keywords: string[];
  level: HelpArticleLevel;
  readMinutes: number;
  /** Organization feature flag key — article hidden when flag is false */
  featureFlag?: string;
  /** Only visible to tenant admins */
  requiresAdmin?: boolean;
  /** Routes that trigger contextual suggestions */
  routeContext?: string[];
  relatedSlugs?: string[];
  blocks: HelpArticleBlock[];
  updatedAt?: string;
}

export interface HelpCategory {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon: string;
  order: number;
  featureFlag?: string;
  requiresAdmin?: boolean;
}

export interface HelpGoalCard {
  id: string;
  title: string;
  description: string;
  articleSlug: string;
  requiresAdmin?: boolean;
  featureFlag?: string;
}

export interface HelpGettingStartedStep {
  order: number;
  title: string;
  description: string;
  articleSlug: string;
  requiresAdmin?: boolean;
  featureFlag?: string;
}

export interface HelpSearchResult {
  article: HelpArticle;
  category: HelpCategory;
  score: number;
  matchedIn: ("title" | "description" | "keywords")[];
}
