export type WordPressPostStatus = "draft" | "publish" | "pending" | "private";
export type WordPressPostMetaValue = string | number | boolean | null;
export type WordPressPostInput = {
    title: string;
    excerpt: string;
    content: string;
    status?: WordPressPostStatus;
    slug?: string;
    sourceUrl?: string;
    sourceAttribution?: string;
    tags?: string[];
    categories?: string[];
    featuredImageUrl?: string;
    meta?: Record<string, WordPressPostMetaValue>;
};
export type WordPressPostResult = {
    id: string;
    url: string;
    status: WordPressPostStatus;
    createdAt: string;
    slug?: string;
};
export type WordPressMediaInput = {
    sourceUrl: string;
    altText?: string;
    filename?: string;
};
export type WordPressMediaResult = {
    id: string;
    url: string;
};
export interface WordPressClient {
    createPost(input: WordPressPostInput): Promise<WordPressPostResult>;
    uploadMedia?(input: WordPressMediaInput): Promise<WordPressMediaResult>;
}
export type MockWordPressClientOptions = {
    baseUrl?: string;
    failCreatePostWith?: string;
};
export declare class MockWordPressClient implements WordPressClient {
    readonly createdPosts: WordPressPostInput[];
    readonly uploadedMedia: WordPressMediaInput[];
    private readonly baseUrl;
    private readonly failCreatePostWith?;
    constructor(options?: MockWordPressClientOptions);
    createPost(input: WordPressPostInput): Promise<WordPressPostResult>;
    uploadMedia(input: WordPressMediaInput): Promise<WordPressMediaResult>;
}
//# sourceMappingURL=client.d.ts.map
