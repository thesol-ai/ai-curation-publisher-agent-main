import { useEffect, useMemo, useState } from "react";
import { Alert, Badge, Button, Card, CardHeader, DataTable, Input, Select, Switch, Textarea } from "../../shared/ui";
import type { JsonObject, JsonValue } from "../../types";
import { readBoolean, readNumber, readObject, readString, statusTone } from "./dashboard-utils";
import { topicLabel } from "./category-topology";

export type PromptDraft = {
  systemPrompt: string;
  userPromptTemplate: string;
  negativePrompt: string;
  temperature: string;
  maxTokens: string;
  riskPolicy: string;
  styleGuide: string;
};

type CategoryWizardPageProps = {
  routes: JsonObject[];
  outputs: JsonObject[];
  profiles: JsonObject[];
  bindings: JsonObject[];
  categoryData: JsonObject | undefined;
  busy: string | undefined;
  onCreateCategory: (input: JsonObject) => Promise<void>;
  onAddLanguage: (category: string, input: JsonObject) => Promise<void>;
  onUpsertPrompt: (input: JsonObject) => Promise<void>;
};

const languageOptions = [
  { value: "fa", label: "fa · فارسی" },
  { value: "en", label: "en · English" },
  { value: "ar", label: "ar · العربية" }
];

const timezoneOptions = ["Asia/Tehran", "UTC", "Europe/London", "America/New_York"].map((value) => ({ value, label: value }));

const defaultPromptDraft: PromptDraft = {
  systemPrompt: "You are an editorial automation assistant for Telegram publishing. Preserve facts, write clearly, and never invent claims.",
  userPromptTemplate: [
    "Category: {{category}}",
    "Language: {{language}}",
    "Source URL: {{sourceUrl}}",
    "Original text:",
    "{{sourceText}}",
    "Links:",
    "{{links}}",
    "Channel signature:",
    "{{channelSignature}}",
    "Task: rewrite the source into a Telegram-ready caption."
  ].join("\n"),
  negativePrompt: "Do not invent prices, quotes, unsupported claims, financial advice, exaggerated promises, or unrelated hashtags.",
  temperature: "0.4",
  maxTokens: "1200",
  riskPolicy: "Do not provide financial advice, unsupported claims, fake quotes, fake numbers, or unverifiable promises.",
  styleGuide: "Concise, accurate, source-faithful, Telegram-ready, and ready for human review."
};

export function CategoryWizardPage(props: CategoryWizardPageProps): JSX.Element {
  const categories = useMemo(() => Array.from(new Set(props.routes.map((route) => readString(route, "category") ?? readString(route, "id") ?? "uncategorized"))).sort(), [props.routes]);
  const [selectedCategory, setSelectedCategory] = useState(categories[0] ?? "crypto");
  useEffect(() => { if (!categories.includes(selectedCategory) && categories[0]) setSelectedCategory(categories[0]); }, [categories.join("|"), selectedCategory]);

  return <div className="page-grid">
    <Card className="hero-card"><CardHeader eyebrow="Category Wizard" title="Create categories, languages, outputs and prompts without raw IDs" description="Use simple flows for daily work. Advanced route/output forms still exist for edge cases." /><Alert title="How this works" tone="info">Category = source topic and editorial domain. Language output = review topic, final channel, publish rules and prompt binding.</Alert></Card>
    <CategoryCards routes={props.routes} outputs={props.outputs} bindings={props.bindings} onSelect={setSelectedCategory} />
    <CreateCategoryWizard topicSuggestions={readArray(props.categoryData, "topicSuggestions")} busy={props.busy} onCreate={props.onCreateCategory} />
    <AddLanguageWizard category={selectedCategory} routes={props.routes} outputs={props.outputs} topicSuggestions={readArray(props.categoryData, "topicSuggestions")} busy={props.busy} onAddLanguage={props.onAddLanguage} />
    <SimplePromptEditor title="Simple Prompt Manager" description="Pick category and language. The dashboard creates or updates the prompt profile and binding automatically." routes={props.routes} outputs={props.outputs} profiles={props.profiles} bindings={props.bindings} selectedCategory={selectedCategory} onCategoryChange={setSelectedCategory} busy={props.busy} onUpsertPrompt={props.onUpsertPrompt} />
  </div>;
}

function CategoryCards({ routes, outputs, bindings, onSelect }: { routes: JsonObject[]; outputs: JsonObject[]; bindings: JsonObject[]; onSelect: (category: string) => void }): JSX.Element {
  const rows = routes.map((route) => {
    const routeId = readString(route, "id") ?? "unknown";
    const category = readString(route, "category") ?? routeId;
    const routeOutputs = outputs.filter((output) => readString(output, "routeId") === routeId);
    const bound = routeOutputs.filter((output) => hasBinding(output, bindings)).length;
    return { category, routeId, source: topicLabel("Source", readString(route, "sourceChatId"), readNumber(route, "sourceThreadId")), outputs: routeOutputs.length, languages: Array.from(new Set(routeOutputs.map((output) => readString(output, "language") ?? "?")).values()).join(", "), prompts: `${bound}/${routeOutputs.length} bound`, status: routeOutputs.length > 0 && bound === routeOutputs.length ? "ready" : "needs setup" };
  });
  return <Card><CardHeader title="Categories" description="One card/table row per category. Select one to add a language or edit prompts." /><DataTable rows={rows} columns={[{ key: "category", label: "Category" }, { key: "source", label: "Source" }, { key: "outputs", label: "Outputs" }, { key: "languages", label: "Languages" }, { key: "prompts", label: "Prompts" }, { key: "status", label: "Status", render: (row) => <Badge tone={readString(row, "status") === "ready" ? "success" : "warning"}>{readString(row, "status")}</Badge> }, { key: "action", label: "Action", render: (row) => <Button size="sm" variant="secondary" onClick={() => onSelect(readString(row, "category") ?? "")}>Select</Button> }]} /></Card>;
}

function CreateCategoryWizard({ topicSuggestions, busy, onCreate }: { topicSuggestions: JsonObject[]; busy: string | undefined; onCreate: (input: JsonObject) => Promise<void> }): JSX.Element {
  const [category, setCategory] = useState("design");
  const [label, setLabel] = useState("Design");
  const [sourceChatId, setSourceChatId] = useState("");
  const [sourceThreadId, setSourceThreadId] = useState("");
  const [languages, setLanguages] = useState("fa");
  const [languageDrafts, setLanguageDrafts] = useState<Record<string, LanguageDraft>>({ fa: defaultLanguageDraft("fa") });
  const parsedLanguages = parseLanguages(languages);
  useEffect(() => setLanguageDrafts((current) => ensureLanguageDrafts(current, parsedLanguages)), [parsedLanguages.join("|")]);

  function applyTopic(value: string): void {
    const topic = topicSuggestions.find((entry) => readString(entry, "id") === value);
    if (!topic) return;
    setSourceChatId(readString(topic, "chatId") ?? "");
    setSourceThreadId(String(readNumber(topic, "threadId") ?? ""));
  }

  return <Card><CardHeader title="Create category" description="Build route, outputs, prompts and bindings in one safe flow." /><div className="grid two"><Input label="Category ID" value={category} onChange={(value) => { setCategory(slug(value)); setLabel(titleCase(value)); }} placeholder="design" /><Input label="Display name" value={label} onChange={setLabel} placeholder="Design" /><Select label="Known source topic" value="" onChange={applyTopic} options={[{ value: "", label: "Choose known topic..." }, ...topicSuggestions.filter((entry) => readString(entry, "role") === "source").map((entry) => ({ value: readString(entry, "id") ?? "", label: readString(entry, "label") ?? "topic" }))]} /><Input label="Source chat ID" value={sourceChatId} onChange={setSourceChatId} placeholder="-100..." /><Input label="Source topic/thread ID" type="number" value={sourceThreadId} onChange={setSourceThreadId} /><Input label="Languages" value={languages} onChange={setLanguages} placeholder="fa,en,ar" /></div><LanguageDraftsEditor languages={parsedLanguages} drafts={languageDrafts} setDrafts={setLanguageDrafts} topicSuggestions={topicSuggestions} category={category} /><Button disabled={busy !== undefined || !category || !sourceChatId || !sourceThreadId || parsedLanguages.length === 0} onClick={() => void onCreate({ category, label, source: { chatId: sourceChatId, threadId: Number(sourceThreadId) }, languages: parsedLanguages.map((language) => languagePayload(language, languageDrafts[language] ?? defaultLanguageDraft(language), category)) })}>Create category</Button></Card>;
}

type LanguageDraft = PromptDraft & { reviewChatId: string; reviewThreadId: string; finalChatId: string; finalThreadId: string; timezone: string; minimumGapMinutes: string; maxPostsPerHour: string; maxPostsPerDay: string; signatureEnabled: boolean; signatureText: string; signatureChannelHandle: string };

function AddLanguageWizard({ category, routes, outputs, topicSuggestions, busy, onAddLanguage }: { category: string; routes: JsonObject[]; outputs: JsonObject[]; topicSuggestions: JsonObject[]; busy: string | undefined; onAddLanguage: (category: string, input: JsonObject) => Promise<void> }): JSX.Element {
  const [language, setLanguage] = useState("ar");
  const [draft, setDraft] = useState<LanguageDraft>(defaultLanguageDraft("ar"));
  const route = routes.find((entry) => (readString(entry, "category") ?? readString(entry, "id")) === category);
  const existingOutputs = outputs.filter((output) => readString(output, "routeId") === readString(route, "id"));
  useEffect(() => { setDraft((current) => ({ ...defaultLanguageDraft(language), ...current, signatureChannelHandle: current.signatureChannelHandle || "@channel" })); }, [language]);
  return <Card><CardHeader title={`Add language to ${category}`} description="Create one output, prompt profile and binding for an existing category." /><div className="grid two"><Select label="Language" value={language} onChange={setLanguage} options={languageOptions} /><Input label="Route" value={readString(route, "id") ?? "missing"} onChange={() => undefined} /></div><LanguageDraftCard language={language} draft={draft} setDraft={(value) => setDraft(value)} topicSuggestions={topicSuggestions} category={category} /><Alert title="Existing outputs" tone="info">{existingOutputs.length === 0 ? "No outputs yet." : existingOutputs.map((output) => readString(output, "id") ?? "output").join(", ")}</Alert><Button disabled={busy !== undefined || !route} onClick={() => void onAddLanguage(category, languagePayload(language, draft, category))}>Create language output</Button></Card>;
}

function LanguageDraftsEditor({ languages, drafts, setDrafts, topicSuggestions, category }: { languages: string[]; drafts: Record<string, LanguageDraft>; setDrafts: (updater: (drafts: Record<string, LanguageDraft>) => Record<string, LanguageDraft>) => void; topicSuggestions: JsonObject[]; category: string }): JSX.Element {
  return <div className="language-drafts">{languages.map((language) => <LanguageDraftCard key={language} language={language} draft={drafts[language] ?? defaultLanguageDraft(language)} setDraft={(next) => setDrafts((current) => ({ ...current, [language]: next }))} topicSuggestions={topicSuggestions} category={category} />)}</div>;
}

function LanguageDraftCard({ language, draft, setDraft, topicSuggestions, category }: { language: string; draft: LanguageDraft; setDraft: (draft: LanguageDraft) => void; topicSuggestions: JsonObject[]; category: string }): JSX.Element {
  function patch(update: Partial<LanguageDraft>): void { setDraft({ ...draft, ...update }); }
  function applyReviewTopic(value: string): void { const topic = topicSuggestions.find((entry) => readString(entry, "id") === value); if (topic) patch({ reviewChatId: readString(topic, "chatId") ?? "", reviewThreadId: String(readNumber(topic, "threadId") ?? "") }); }
  return <div className="language-draft-card"><div className="setting-title"><strong>{language.toUpperCase()} output</strong><Badge tone="info">{category}_{language}</Badge></div><div className="grid two"><Select label="Known review topic" value="" onChange={applyReviewTopic} options={[{ value: "", label: "Choose review topic..." }, ...topicSuggestions.filter((entry) => readString(entry, "role") === "review").map((entry) => ({ value: readString(entry, "id") ?? "", label: readString(entry, "label") ?? "topic" }))]} /><Input label="Review chat ID" value={draft.reviewChatId} onChange={(reviewChatId) => patch({ reviewChatId })} /><Input label="Review topic/thread ID" type="number" value={draft.reviewThreadId} onChange={(reviewThreadId) => patch({ reviewThreadId })} /><Input label="Final channel/chat ID" value={draft.finalChatId} onChange={(finalChatId) => patch({ finalChatId, signatureChannelHandle: draft.signatureChannelHandle || finalChatId })} placeholder="@channel" /><Select label="Timezone" value={draft.timezone} onChange={(timezone) => patch({ timezone })} options={timezoneOptions} /><Input label="Minimum gap minutes" type="number" value={draft.minimumGapMinutes} onChange={(minimumGapMinutes) => patch({ minimumGapMinutes })} /><Input label="Max posts/hour" type="number" value={draft.maxPostsPerHour} onChange={(maxPostsPerHour) => patch({ maxPostsPerHour })} /><Input label="Max posts/day" type="number" value={draft.maxPostsPerDay} onChange={(maxPostsPerDay) => patch({ maxPostsPerDay })} /></div><SimplePromptFields draft={draft} setDraft={(promptDraft) => setDraft({ ...draft, ...promptDraft })} /><Switch label="Signature enabled" checked={draft.signatureEnabled} onChange={(signatureEnabled) => patch({ signatureEnabled })} /><div className="grid two"><Input label="Signature text" value={draft.signatureText} onChange={(signatureText) => patch({ signatureText })} /><Input label="Signature @handle" value={draft.signatureChannelHandle} onChange={(signatureChannelHandle) => patch({ signatureChannelHandle })} /></div></div>;
}

export function SimplePromptEditor({ title, description, routes, outputs, profiles, bindings, selectedCategory, onCategoryChange, busy, onUpsertPrompt }: { title: string; description: string; routes: JsonObject[]; outputs: JsonObject[]; profiles: JsonObject[]; bindings: JsonObject[]; selectedCategory?: string; onCategoryChange?: (category: string) => void; busy: string | undefined; onUpsertPrompt: (input: JsonObject) => Promise<void> }): JSX.Element {
  const categories = Array.from(new Set(routes.map((route) => readString(route, "category") ?? readString(route, "id") ?? "uncategorized"))).sort();
  const [category, setCategory] = useState(selectedCategory ?? categories[0] ?? "crypto");
  const categoryRoutes = routes.filter((route) => (readString(route, "category") ?? readString(route, "id")) === category);
  const categoryOutputs = outputs.filter((output) => categoryRoutes.some((route) => readString(route, "id") === readString(output, "routeId")));
  const [outputId, setOutputId] = useState(readString(categoryOutputs[0], "id") ?? "");
  const selectedOutput = categoryOutputs.find((output) => readString(output, "id") === outputId) ?? categoryOutputs[0];
  const binding = selectedOutput ? bindings.find((entry) => readString(entry, "routeOutputId") === readString(selectedOutput, "id") || (readString(entry, "routeId") === readString(selectedOutput, "routeId") && readString(entry, "language") === readString(selectedOutput, "language"))) : undefined;
  const profile = binding ? profiles.find((entry) => readString(entry, "id") === readString(binding, "promptProfileId")) : undefined;
  const [draft, setDraft] = useState<PromptDraft>(promptDraftFromProfile(profile, readString(selectedOutput, "language") ?? "fa"));
  useEffect(() => { if (selectedCategory && selectedCategory !== category) setCategory(selectedCategory); }, [selectedCategory]);
  useEffect(() => { onCategoryChange?.(category); }, [category]);
  useEffect(() => { setOutputId(readString(categoryOutputs[0], "id") ?? ""); }, [category]);
  useEffect(() => { setDraft(promptDraftFromProfile(profile, readString(selectedOutput, "language") ?? "fa")); }, [readString(profile, "id"), readString(selectedOutput, "id")]);
  return <Card><CardHeader title={title} description={description} /><div className="grid two"><Select label="Category" value={category} onChange={setCategory} options={categories.length > 0 ? categories.map((value) => ({ value, label: value })) : [{ value: "", label: "No categories" }]} /><Select label="Language output" value={readString(selectedOutput, "id") ?? outputId} onChange={setOutputId} options={categoryOutputs.length > 0 ? categoryOutputs.map((output) => ({ value: readString(output, "id") ?? "", label: `${readString(output, "id") ?? "output"} · ${readString(output, "language") ?? "lang"}` })) : [{ value: "", label: "No outputs for this category" }]} /></div>{selectedOutput ? <div className="context-summary"><Badge tone={binding ? "success" : "warning"}>{binding ? "connected" : "prompt missing"}</Badge><span>Output: <strong>{readString(selectedOutput, "id")}</strong></span><span>Review: {topicLabel("Review", readString(selectedOutput, "reviewChatId"), readNumber(selectedOutput, "reviewThreadId"))}</span><span>Final: {readString(selectedOutput, "finalChatId") ?? "missing"}</span></div> : <Alert title="No output" tone="warning">Create an output before saving a prompt for this category/language.</Alert>}<SimplePromptFields draft={draft} setDraft={(promptDraft) => setDraft({ ...draft, ...promptDraft })} /><div className="button-row"><Button disabled={busy !== undefined || !selectedOutput} onClick={() => void onUpsertPrompt({ category, language: readString(selectedOutput, "language") ?? "fa", routeId: readString(selectedOutput, "routeId") ?? "", routeOutputId: readString(selectedOutput, "id") ?? "", contentType: "social_post", prompt: promptPayload(draft) })}>Save prompt and connect</Button></div></Card>;
}

function SimplePromptFields({ draft, setDraft }: { draft: PromptDraft; setDraft: (draft: PromptDraft) => void }): JSX.Element {
  const patch = (update: Partial<PromptDraft>): void => setDraft({ ...draft, ...update });
  return <div className="simple-prompt-fields"><Textarea label="Prompt text / system instruction" value={draft.systemPrompt} onChange={(systemPrompt) => patch({ systemPrompt })} rows={6} /><Textarea label="User prompt template" value={draft.userPromptTemplate} onChange={(userPromptTemplate) => patch({ userPromptTemplate })} rows={7} /><Textarea label="Negative prompt" value={draft.negativePrompt} onChange={(negativePrompt) => patch({ negativePrompt })} rows={3} placeholder="Things the AI must avoid." /><div className="grid two"><Input label="Temperature" type="number" value={draft.temperature} onChange={(temperature) => patch({ temperature })} /><Input label="Max tokens" type="number" value={draft.maxTokens} onChange={(maxTokens) => patch({ maxTokens })} /></div><Textarea label="Risk policy" value={draft.riskPolicy} onChange={(riskPolicy) => patch({ riskPolicy })} rows={3} /><Textarea label="Style guide" value={draft.styleGuide} onChange={(styleGuide) => patch({ styleGuide })} rows={3} /></div>;
}

function defaultLanguageDraft(language: string): LanguageDraft {
  return { ...defaultPromptDraft, styleGuide: defaultStyleGuide(language), reviewChatId: "", reviewThreadId: "", finalChatId: "", finalThreadId: "", timezone: "Asia/Tehran", minimumGapMinutes: "10", maxPostsPerHour: "4", maxPostsPerDay: "24", signatureEnabled: true, signatureText: "عضویت در کانال:", signatureChannelHandle: "" };
}

function promptDraftFromProfile(profile: JsonObject | undefined, language: string): PromptDraft {
  return { systemPrompt: readString(profile, "systemPrompt") ?? defaultPromptDraft.systemPrompt, userPromptTemplate: readString(profile, "userPromptTemplate") ?? defaultPromptDraft.userPromptTemplate, negativePrompt: readString(profile, "negativePrompt") ?? defaultPromptDraft.negativePrompt, temperature: String(readNumber(profile, "temperature") ?? 0.4), maxTokens: String(readNumber(profile, "maxTokens") ?? 1200), riskPolicy: readString(profile, "riskPolicy") ?? defaultPromptDraft.riskPolicy, styleGuide: readString(profile, "styleGuide") ?? defaultStyleGuide(language) };
}

function promptPayload(draft: PromptDraft): JsonObject {
  return { systemPrompt: draft.systemPrompt, userPromptTemplate: draft.userPromptTemplate, negativePrompt: draft.negativePrompt, temperature: Number(draft.temperature), maxTokens: Number(draft.maxTokens), riskPolicy: draft.riskPolicy, styleGuide: draft.styleGuide };
}

function languagePayload(language: string, draft: LanguageDraft, category: string): JsonObject {
  return { language, reviewChatId: draft.reviewChatId, reviewThreadId: Number(draft.reviewThreadId), finalChatId: draft.finalChatId, ...(draft.finalThreadId.trim() ? { finalThreadId: Number(draft.finalThreadId) } : {}), timezone: draft.timezone, minimumGapMinutes: Number(draft.minimumGapMinutes), maxPostsPerHour: Number(draft.maxPostsPerHour), maxPostsPerDay: Number(draft.maxPostsPerDay), queuePriority: 100, signatureEnabled: draft.signatureEnabled, signatureText: draft.signatureText, signatureChannelHandle: draft.signatureChannelHandle || draft.finalChatId, prompt: { ...promptPayload(draft), systemPrompt: draft.systemPrompt || `You are an editorial assistant for ${category}/${language}.` } };
}

function parseLanguages(value: string): string[] {
  return Array.from(new Set(value.split(/[ ,]+/).map((entry) => entry.trim().toLowerCase()).filter(Boolean))).slice(0, 6);
}

function ensureLanguageDrafts(current: Record<string, LanguageDraft>, languages: string[]): Record<string, LanguageDraft> {
  const next = { ...current };
  for (const language of languages) if (!next[language]) next[language] = defaultLanguageDraft(language);
  return next;
}

function hasBinding(output: JsonObject, bindings: JsonObject[]): boolean {
  return bindings.some((binding) => readString(binding, "routeOutputId") === readString(output, "id") || (readString(binding, "routeId") === readString(output, "routeId") && readString(binding, "language") === readString(output, "language")));
}

function readArray(value: unknown, key: string): JsonObject[] {
  const object = readObject(value);
  const raw = object?.[key];
  return Array.isArray(raw) ? raw.filter((entry): entry is JsonObject => typeof entry === "object" && entry !== null && !Array.isArray(entry)) : [];
}

function slug(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, ""); }
function titleCase(value: string): string { return slug(value).split(/[_:-]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ") || value; }
function defaultStyleGuide(language: string): string { if (language === "fa") return "فارسی روان، دقیق، کوتاه، مناسب تلگرام، بدون اغراق و وفادار به منبع."; if (language === "ar") return "Arabic should be clear, concise, Telegram-ready, source-faithful, and not exaggerated."; return defaultPromptDraft.styleGuide; }
