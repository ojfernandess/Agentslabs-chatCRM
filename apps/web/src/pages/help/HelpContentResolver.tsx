import { useParams } from "react-router-dom";
import { getArticleBySlug } from "@/lib/help/articles";
import { getCategoryBySlug } from "@/lib/help/categories";
import { HelpArticlePage } from "./HelpArticlePage";
import { HelpCategoryPage } from "./HelpCategoryPage";

/** Resolves /help/:splat to category listing or article by slug */
export function HelpContentResolver() {
  const params = useParams();
  const slug = (params["*"] ?? "").replace(/^\/+|\/+$/g, "");

  if (!slug) return null;

  if (getArticleBySlug(slug)) {
    return <HelpArticlePage />;
  }

  if (getCategoryBySlug(slug)) {
    return <HelpCategoryPage categorySlugOverride={slug} />;
  }

  return <HelpArticlePage />;
}
