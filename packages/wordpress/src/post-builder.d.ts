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
export declare function buildWordPressPostPayload(input: BuildWordPressPostInput): WordPressPostInput;
//# sourceMappingURL=post-builder.d.ts.map
