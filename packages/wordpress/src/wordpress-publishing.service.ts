import type { WordPressClient, WordPressPostInput, WordPressPostResult, WordPressPostStatus } from "./client";
import { buildWordPressPostPayload } from "./post-builder";
import { validateWordPressOutput, type WordPressAiOutput, type WordPressOutputValidationIssue } from "./wordpress-output";

export type WordPressPostMetadata = {
  itemId: string;
  wordpressPostId: string;
  wordpressUrl: string;
  status: WordPressPostStatus;
  publishedAt: string;
};

export interface WordPressPostMetadataStore {
  recordPublishedPost(metadata: WordPressPostMetadata): Promise<void>;
}

export type PublishWordPressInput = {
  itemId: string;
  output: WordPressAiOutput;
  sourceUrl?: string;
  slug?: string;
  featuredImageUrl?: string;
  status?: WordPressPostStatus;
};

export type PublishWordPressResult =
  | {
      outcome: "published";
      itemId: string;
      post: WordPressPostResult;
      payload: WordPressPostInput;
    }
  | {
      outcome: "invalid_output";
      itemId: string;
      issues: WordPressOutputValidationIssue[];
    }
  | {
      outcome: "failed";
      itemId: string;
      errorMessage: string;
      payload: WordPressPostInput;
    };

export class WordPressPublishingService {
  constructor(
    private readonly client: WordPressClient,
    private readonly metadataStore?: WordPressPostMetadataStore
  ) {}

  async publish(input: PublishWordPressInput): Promise<PublishWordPressResult> {
    const validation = validateWordPressOutput(input.output);
    if (!validation.valid) {
      return {
        outcome: "invalid_output",
        itemId: input.itemId,
        issues: validation.issues
      };
    }

    const payload = buildWordPressPostPayload({
      output: input.output,
      ...(input.sourceUrl === undefined ? {} : { sourceUrl: input.sourceUrl }),
      ...(input.slug === undefined ? {} : { slug: input.slug }),
      ...(input.featuredImageUrl === undefined ? {} : { featuredImageUrl: input.featuredImageUrl }),
      status: input.status ?? "draft"
    });

    try {
      const post = await this.client.createPost(payload);
      await this.metadataStore?.recordPublishedPost({
        itemId: input.itemId,
        wordpressPostId: post.id,
        wordpressUrl: post.url,
        status: post.status,
        publishedAt: post.createdAt
      });

      return {
        outcome: "published",
        itemId: input.itemId,
        post,
        payload
      };
    } catch (error) {
      return {
        outcome: "failed",
        itemId: input.itemId,
        errorMessage: error instanceof Error ? error.message : "Unknown WordPress publish failure",
        payload
      };
    }
  }
}
