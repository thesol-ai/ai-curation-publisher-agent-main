import type { WordPressPostInput, WordPressPostStatus } from "./client";
import type { WordPressAiOutput } from "./wordpress-output";

export type BuildWordPressPostInput = {
  output: WordPressAiOutput;
  sourceUrl?: string;
  slug?: string;
  featuredImageUrl?: string;
  status?: WordPressPostStatus;
  additionalMeta?: Record<string, string | number | boolean | null>;
};

export function buildWordPressPostPayload(input: BuildWordPressPostInput): WordPressPostInput {
  const meta: Record<string, string | number | boolean | null> = {
    ...(input.output.seo_title === undefined ? {} : { seo_title: input.output.seo_title }),
    ...(input.output.seo_description === undefined ? {} : { seo_description: input.output.seo_description }),
    ...(input.sourceUrl === undefined ? {} : { source_url: input.sourceUrl }),
    ...(input.additionalMeta ?? {})
  };

  return {
    title: input.output.title_fa,
    excerpt: input.output.excerpt_fa,
    content: buildBodyContent(input.output, input.sourceUrl),
    status: input.status ?? "draft",
    ...(input.slug === undefined ? {} : { slug: input.slug }),
    ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
    sourceAttribution: input.output.source_attribution,
    tags: input.output.tags,
    categories: input.output.categories,
    ...(input.featuredImageUrl === undefined ? {} : { featuredImageUrl: input.featuredImageUrl }),
    ...(Object.keys(meta).length === 0 ? {} : { meta })
  };
}

function buildBodyContent(output: WordPressAiOutput, sourceUrl: string | undefined): string {
  const body = output.body_fa.trim();
  const attribution = output.source_attribution.trim();
  const sourceLink = sourceUrl === undefined ? "" : `\n\n<p><a href=\"${escapeHtml(sourceUrl)}\" rel=\"nofollow noopener\">Source link</a></p>`;

  return [`<p>${escapeHtml(body).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>`, `<p>${escapeHtml(attribution)}</p>${sourceLink}`].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
