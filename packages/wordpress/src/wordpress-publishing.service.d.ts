import type { WordPressClient, WordPressPostInput, WordPressPostResult, WordPressPostStatus } from "./client";
import { type WordPressAiOutput, type WordPressOutputValidationIssue } from "./wordpress-output";
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
export type PublishWordPressResult = {
    outcome: "published";
    itemId: string;
    post: WordPressPostResult;
    payload: WordPressPostInput;
} | {
    outcome: "invalid_output";
    itemId: string;
    issues: WordPressOutputValidationIssue[];
} | {
    outcome: "failed";
    itemId: string;
    errorMessage: string;
    payload: WordPressPostInput;
};
export declare class WordPressPublishingService {
    private readonly client;
    private readonly metadataStore?;
    constructor(client: WordPressClient, metadataStore?: WordPressPostMetadataStore | undefined);
    publish(input: PublishWordPressInput): Promise<PublishWordPressResult>;
}
//# sourceMappingURL=wordpress-publishing.service.d.ts.map
