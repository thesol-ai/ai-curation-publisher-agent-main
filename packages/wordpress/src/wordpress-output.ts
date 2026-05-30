export type WordPressSeoMetadata = {
  seoTitle?: string;
  seoDescription?: string;
};

export type WordPressAiOutput = {
  title_fa: string;
  excerpt_fa: string;
  body_fa: string;
  tags: string[];
  categories: string[];
  source_attribution: string;
  seo_title?: string;
  seo_description?: string;
};

export type WordPressOutputValidationIssue = {
  field: keyof WordPressAiOutput;
  message: string;
};

export type WordPressOutputValidationResult = {
  valid: boolean;
  issues: WordPressOutputValidationIssue[];
};

export function validateWordPressOutput(output: WordPressAiOutput): WordPressOutputValidationResult {
  const issues: WordPressOutputValidationIssue[] = [];

  if (!output.title_fa.trim()) {
    issues.push({ field: "title_fa", message: "WordPress title is required." });
  }

  if (!output.excerpt_fa.trim()) {
    issues.push({ field: "excerpt_fa", message: "WordPress excerpt is required." });
  }

  if (!output.body_fa.trim()) {
    issues.push({ field: "body_fa", message: "WordPress body is required." });
  }

  if (!output.source_attribution.trim()) {
    issues.push({ field: "source_attribution", message: "Source attribution is required." });
  }

  return {
    valid: issues.length === 0,
    issues
  };
}

export function createMockWordPressOutput(overrides: Partial<WordPressAiOutput> = {}): WordPressAiOutput {
  return {
    title_fa: "عنوان وردپرس",
    excerpt_fa: "خلاصه کوتاه برای وردپرس",
    body_fa: "متن کامل وردپرس برای انتشار به‌صورت پیش‌نویس.",
    tags: ["curation", "ai"],
    categories: ["news"],
    source_attribution: "Source: manual ingest",
    seo_title: "عنوان سئو",
    seo_description: "توضیح کوتاه سئو",
    ...overrides
  };
}
