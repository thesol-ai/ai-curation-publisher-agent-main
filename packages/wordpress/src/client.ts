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

export class MockWordPressClient implements WordPressClient {
  readonly createdPosts: WordPressPostInput[] = [];
  readonly uploadedMedia: WordPressMediaInput[] = [];

  private readonly baseUrl: string;
  private readonly failCreatePostWith?: string;

  constructor(options: MockWordPressClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://wordpress.local";
    if (options.failCreatePostWith !== undefined) {
      this.failCreatePostWith = options.failCreatePostWith;
    }
  }

  async createPost(input: WordPressPostInput): Promise<WordPressPostResult> {
    if (this.failCreatePostWith) {
      throw new Error(this.failCreatePostWith);
    }

    this.createdPosts.push(input);
    const id = `mock_wp_post_${this.createdPosts.length}`;
    const status = input.status ?? "draft";
    const slug = input.slug ?? createMockSlug(input.title, id);

    return {
      id,
      url: `${this.baseUrl.replace(/\/$/, "")}/${slug}`,
      status,
      slug,
      createdAt: new Date(0).toISOString()
    };
  }

  async uploadMedia(input: WordPressMediaInput): Promise<WordPressMediaResult> {
    this.uploadedMedia.push(input);
    const id = `mock_wp_media_${this.uploadedMedia.length}`;
    return {
      id,
      url: input.sourceUrl
    };
  }
}

function createMockSlug(title: string, fallback: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || fallback;
}
