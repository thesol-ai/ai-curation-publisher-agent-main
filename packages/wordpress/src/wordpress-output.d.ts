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
export declare function validateWordPressOutput(output: WordPressAiOutput): WordPressOutputValidationResult;
export declare function createMockWordPressOutput(overrides?: Partial<WordPressAiOutput>): WordPressAiOutput;
//# sourceMappingURL=wordpress-output.d.ts.map
