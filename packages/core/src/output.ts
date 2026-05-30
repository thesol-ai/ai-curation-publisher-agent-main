export const OUTPUT_TARGETS = ["telegram", "wordpress"] as const;
export type OutputTarget = typeof OUTPUT_TARGETS[number];

export const OUTPUT_STATUSES = ["pending", "generated", "schema_invalid", "failed"] as const;
export type OutputStatus = typeof OUTPUT_STATUSES[number];

export type TelegramAiOutput = {
  language_detected: string;
  telegram_caption_fa: string;
  summary_fa: string;
  hashtags: string[];
  risk_flags: string[];
  relevance_score: number;
  quality_score: number;
};

export type WordPressAiOutput = {
  title: string;
  slug: string;
  excerpt: string;
  body_html: string;
  meta_description: string;
  tags: string[];
  category: string;
  source_attribution: string;
};

export type GeneratedOutput<TOutput = TelegramAiOutput | WordPressAiOutput> = {
  id: string;
  itemId: string;
  target: OutputTarget;
  promptVersion: string;
  status: OutputStatus;
  output: TOutput;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    estimatedCostUsd?: number;
  };
  createdAt: string;
  updatedAt: string;
};
