import { test, expect } from "bun:test";
import { z } from "./index";
import { zugar } from "./index";
import { extractFields } from "./extractFields";
import { createSchema } from "./createSchema";
import { buildUserPrompt } from "./buildUserPrompt";
import { inferMediaType } from "./index";

// ── Mock model ────────────────────────────────────────────────────────────

function createMockModel(output: unknown) {
	return {
		specificationVersion: "v4" as const,
		provider: "mock.provider",
		modelId: "mock-model",
		supportedUrls: Promise.resolve([]),
		doGenerate() {
			return Promise.resolve({
				content: [{ type: "text" as const, text: JSON.stringify(output) }],
				finishReason: { unified: "stop" as const, raw: undefined },
				usage: {
					inputTokens: { total: 0, cached: 0 },
					outputTokens: { total: 0 },
					reasoningTokens: 0,
					totalTokens: 0,
				},
			});
		},
		doStream() {
			throw new Error("not implemented");
		},
	} as any;
}

function createCapturingMockModel(output: unknown, captured: { args?: any }) {
	const base = createMockModel(output) as any;
	const originalDoGenerate = base.doGenerate.bind(base);
	base.doGenerate = (args: any) => {
		captured.args = args;
		return originalDoGenerate(args);
	};
	return base;
}

// ── .meta() tests ────────────────────────────────────────────────────────────

test(".meta({ description: ... }) sets .description on Zod v4", () => {
	const s = z.string().meta({ description: "my description" });
	expect(s.description).toBe("my description");
});

test(".meta() preserves Zod type functionality", () => {
	const s = z.string().meta({ description: "a name" });
	const schema = z.object({ name: s });

	const result = schema.parse({ name: "hello" });
	expect(result).toEqual({ name: "hello" });

	expect(() => schema.parse({ name: 123 })).toThrow();
});

// ── extractFields tests ──────────────────────────────────────────────────────

test("extractFields reads .description from Zod v4 fields", () => {
	const schema = z.object({
		subject: z.string().meta({ description: "The main subject" }),
		tone: z.string().meta({ description: "The mood" }),
		count: z.number().meta({ description: "A count" }),
	});

	const fields: Array<{ name: string; description: string }> = [];
	const shape = schema.shape;
	for (const [key, fieldSchema] of Object.entries(shape)) {
		const desc = (fieldSchema as any).description ?? "";
		fields.push({ name: key, description: desc });
	}

	expect(fields).toEqual([
		{ name: "subject", description: "The main subject" },
		{ name: "tone", description: "The mood" },
		{ name: "count", description: "A count" },
	]);
});

// ── buildUserPrompt direct tests ────────────────────────────────────────────

test("buildUserPrompt lists output fields in extraction mode", () => {
	const schema = z.object({
		subject: z.string().meta({ description: "The main subject" }),
		tone: z.string().meta({ description: "The mood" }),
	});

	const prompt = buildUserPrompt("image", undefined, schema);

	expect(prompt).toContain("Return a JSON object with these EXACT keys:");
	expect(prompt).toContain("  subject: The main subject");
	expect(prompt).toContain("  tone: The mood");
	expect(prompt).toContain(
		"Analyze the provided image and extract all fields.",
	);
	expect(prompt).toContain(
		"Respond with ONLY the JSON object. Do not include markdown or explanations.",
	);
});

test("buildUserPrompt renders input data in transformation mode", () => {
	const inputSchema = z.object({
		subject: z.string().meta({ description: "The main subject" }),
		tone: z.string().meta({ description: "The mood" }),
	});
	const outputSchema = z.object({
		prompt: z.string().meta({ description: "The generated prompt" }),
	});

	const result = buildUserPrompt("schema", inputSchema, outputSchema, {
		subject: "cat",
		tone: "chill",
	});

	expect(result).toContain("Input fields:");
	expect(result).toContain("  subject: The main subject");
	expect(result).toContain("Input data:");
	expect(result).toContain("  subject: cat");
	expect(result).toContain("  tone: chill");
	expect(result).toContain("Output fields:");
	expect(result).toContain("  prompt: The generated prompt");
});

test("buildUserPrompt marks missing values as (empty)", () => {
	const inputSchema = z.object({
		subject: z.string().meta({ description: "A subject" }),
		tone: z.string().meta({ description: "A tone" }),
	});

	const result = buildUserPrompt("schema", inputSchema, inputSchema, {
		subject: "cat",
		tone: undefined,
	});

	expect(result).toContain("  subject: cat");
	expect(result).toContain("  tone: (empty)");
});

test("buildUserPrompt does not mark empty strings as (empty)", () => {
	const inputSchema = z.object({
		name: z.string().meta({ description: "A name" }),
	});

	const result = buildUserPrompt("schema", inputSchema, inputSchema, {
		name: "",
	});

	expect(result).toContain("  name: ");
	expect(result).not.toContain("(empty)");
});

test("buildUserPrompt appends context when provided", () => {
	const schema = z.object({
		x: z.string().meta({ description: "An x" }),
	});

	const withContext = buildUserPrompt(
		"text",
		undefined,
		schema,
		undefined,
		"prior step",
	);

	expect(withContext).toContain("Previous context: prior step");
});

test("buildUserPrompt resolves nested object paths in input data", () => {
	const inputSchema = z.object({
		address: z.object({
			city: z.string().meta({ description: "City name" }),
			zip: z.string().meta({ description: "ZIP code" }),
		}),
	});

	const result = buildUserPrompt("schema", inputSchema, inputSchema, {
		address: { city: "Portland", zip: "97201" },
	});

	expect(result).toContain("  address.city: Portland");
	expect(result).toContain("  address.zip: 97201");
	expect(result).not.toContain("address.city: (empty)");
});

test("buildUserPrompt resolves array-of-object paths as JSON", () => {
	const inputSchema = z.object({
		items: z.array(
			z.object({ id: z.number().meta({ description: "Item ID" }) }),
		),
	});

	const result = buildUserPrompt("schema", inputSchema, inputSchema, {
		items: [{ id: 1 }, { id: 2 }],
	});

	expect(result).toContain(`  items[*].id: [{"id":1},{"id":2}]`);
});

test("buildUserPrompt marks missing nested paths as (empty)", () => {
	const inputSchema = z.object({
		address: z.object({
			city: z.string().meta({ description: "City name" }),
		}),
	});

	const result = buildUserPrompt("schema", inputSchema, inputSchema, {});

	expect(result).toContain("  address.city: (empty)");
});

// ── someModelsJustWontFuckingListen tests ──────────────────────────────────

import { someModelsJustWontFuckingListen } from "./someModelsJustWontFuckingListen";

test("strips markdown code blocks and parses JSON", () => {
	const input = '```json\n{"key": "value"}\n```';
	const result = someModelsJustWontFuckingListen(input);
	expect(result).toEqual({ key: "value" });
});

test("parses plain JSON without code blocks", () => {
	const input = '{"key": "value"}';
	const result = someModelsJustWontFuckingListen(input);
	expect(result).toEqual({ key: "value" });
});

test("throws on malformed JSON", () => {
	const input = "not valid json";
	expect(() => someModelsJustWontFuckingListen(input)).toThrow(
		"Failed to parse LLM response as JSON",
	);
});

// ── zugar() core function tests ──────────────────────────────────────────

test("zugar() returns typed output in extraction mode", async () => {
	const schema = z.object({
		subject: z.string().meta({ description: "The main subject" }),
		tone: z.string().meta({ description: "The mood" }),
	});

	const mockModel = createMockModel({ subject: "cat", tone: "chill" });

	const module = zugar({
		description: "Analyze text",
		schema,
		model: mockModel,
		inputKind: "text",
	});

	const result = await module({ text: "a relaxed cat" });
	expect(result).toEqual({ subject: "cat", tone: "chill" });
});

test("zugar() returns typed output in transformation mode", async () => {
	const inputSchema = z.object({
		subject: z.string().meta({ description: "The subject" }),
	});

	const outputSchema = z.object({
		prompt: z.string().meta({ description: "Generated prompt" }),
	});

	const mockModel = createMockModel({ prompt: "A photo of a cat" });

	const module = zugar({
		description: "Generate prompt from analysis",
		inputSchema,
		schema: outputSchema,
		model: mockModel,
		inputKind: "schema",
	});

	const result = await module({ data: { subject: "cat" } });
	expect(result).toEqual({ prompt: "A photo of a cat" });
});

test("zugar() throws on invalid input in transformation mode", async () => {
	const inputSchema = z.object({
		count: z.number().meta({ description: "A count" }),
	});

	const outputSchema = z.object({
		result: z.string().meta({ description: "Result" }),
	});

	const mockModel = createMockModel({ result: "ok" });

	const module = zugar({
		description: "Process",
		inputSchema,
		schema: outputSchema,
		model: mockModel,
		inputKind: "schema",
	});

	await expect(module({ data: { count: "not a number" } })).rejects.toThrow(
		"Input validation failed",
	);
});

test("zugar() throws when inputSchema provided but data missing", async () => {
	const inputSchema = z.object({
		name: z.string().meta({ description: "A name" }),
	});

	const outputSchema = z.object({
		greeting: z.string().meta({ description: "Greeting" }),
	});

	const mockModel = createMockModel({ greeting: "hello" });

	const module = zugar({
		description: "Greet",
		inputSchema,
		schema: outputSchema,
		model: mockModel,
		inputKind: "schema",
	});

	await expect(module({ text: "wrong shape" })).rejects.toThrow();
});

test("zugar() rejects text kind without text", async () => {
	const module = zugar({
		description: "d",
		schema: z.object({ x: z.string().meta({ description: "x" }) }),
		model: createMockModel({ x: "y" }),
		inputKind: "text",
	});
	await expect(module({})).rejects.toThrow(
		'inputKind "text" requires a "text" property',
	);
});

test("zugar() rejects image kind without image", async () => {
	const module = zugar({
		description: "d",
		schema: z.object({ x: z.string().meta({ description: "x" }) }),
		model: createMockModel({ x: "y" }),
		inputKind: "image",
	});
	await expect(module({ text: "no image here" })).rejects.toThrow(
		'inputKind "image" requires an "image" property',
	);
});

test("zugar() rejects audio kind without audio", async () => {
	const module = zugar({
		description: "d",
		schema: z.object({ x: z.string().meta({ description: "x" }) }),
		model: createMockModel({ x: "y" }),
		inputKind: "audio",
	});
	await expect(module({})).rejects.toThrow(
		'inputKind "audio" requires an "audio" property',
	);
});

test("zugar() rejects multimodal kind with no modality at all", async () => {
	const module = zugar({
		description: "d",
		schema: z.object({ x: z.string().meta({ description: "x" }) }),
		model: createMockModel({ x: "y" }),
		inputKind: "multimodal",
	});
	await expect(module({})).rejects.toThrow(
		'inputKind "multimodal" requires at least one of',
	);
});

test("zugar() accepts multimodal kind with any single modality", async () => {
	const module = zugar({
		description: "d",
		schema: z.object({ x: z.string().meta({ description: "x" }) }),
		model: createMockModel({ x: "y" }),
		inputKind: "multimodal",
	});
	await expect(module({ text: "just text" })).resolves.toEqual({ x: "y" });
});

test("zugar() recovers when model error carries fenced JSON in .text", async () => {
	const failingModel = {
		...createMockModel({ unused: true }),
		doGenerate() {
			return Promise.reject({
				text: '```json\n{"subject": "cat", "tone": "chill"}\n```',
			});
		},
	} as any;

	const module = zugar({
		description: "d",
		schema: z.object({
			subject: z.string().meta({ description: "s" }),
			tone: z.string().meta({ description: "t" }),
		}),
		model: failingModel,
		inputKind: "text",
	});

	await expect(module({ text: "a cat" })).resolves.toEqual({
		subject: "cat",
		tone: "chill",
	});
});

test("zugar() throws schema-mismatch error when fallback parses but fails validation", async () => {
	const failingModel = {
		...createMockModel({ unused: true }),
		doGenerate() {
			return Promise.reject({ text: '```json\n{"wrong": "shape"}\n```' });
		},
	} as any;

	const module = zugar({
		description: "d",
		schema: z.object({
			subject: z.string().meta({ description: "s" }),
		}),
		model: failingModel,
		inputKind: "text",
	});

	await expect(module({ text: "a cat" })).rejects.toThrow(
		"LLM response did not match output schema",
	);
});

test("zugar() rethrows errors without a .text property", async () => {
	const failingModel = {
		...createMockModel({ unused: true }),
		doGenerate() {
			return Promise.reject(new Error("network down"));
		},
	} as any;

	const module = zugar({
		description: "d",
		schema: z.object({
			subject: z.string().meta({ description: "s" }),
		}),
		model: failingModel,
		inputKind: "text",
	});

	await expect(module({ text: "a cat" })).rejects.toThrow("network down");
});

test("inferMediaType extracts type from data URLs", () => {
	expect(inferMediaType("data:image/jpeg;base64,abc")).toBe("image/jpeg");
});

test("inferMediaType falls back to image/png without a data URL", () => {
	expect(inferMediaType("UklGRh==")).toBe("image/png");
});

test("inferMediaType honors explicit fallback", () => {
	expect(inferMediaType("plain-string", "audio/wav")).toBe("audio/wav");
});

test("audio kind without transcriptionModel attaches a wav file part", async () => {
	const captured: { args?: any } = {};
	const module = zugar({
		description: "d",
		schema: z.object({ x: z.string().meta({ description: "x" }) }),
		model: createCapturingMockModel({ x: "y" }, captured),
		inputKind: "audio",
	});

	await module({ audio: "UklGRh==" });

	const userMessage = captured.args.prompt.at(-1);
	const parts = Array.isArray(userMessage?.content)
		? userMessage.content
		: [userMessage?.content];
	expect(
		parts.some((p: any) => p.type === "file" && p.mediaType === "audio/wav"),
	).toBe(true);
});

test("multimodal kind orders prompt, image, transcript, text", async () => {
	const captured: { args?: any } = {};
	const transcriptionModel = {
		specificationVersion: "v2",
		provider: "mock.provider",
		modelId: "mock-whisper",
		doGenerate: async () => ({
			text: "hello world",
			durationSeconds: 1,
			language: "en",
			warnings: [],
		}),
	} as any;

	const module = zugar({
		description: "d",
		schema: z.object({ x: z.string().meta({ description: "x" }) }),
		model: createCapturingMockModel({ x: "y" }, captured),
		inputKind: "multimodal",
		transcriptionModel,
	});

	await module({
		image: "data:image/png;base64,abc",
		audio: "UklGRh==",
		text: "describe it",
	});

	const userMessage = captured.args.prompt.at(-1);
	const parts = Array.isArray(userMessage?.content)
		? userMessage.content
		: [userMessage?.content];
	expect(parts[0]?.type).toBe("text"); // built prompt
	expect(
		parts.some((p: any) => p.type === "file" && p.mediaType === "image/png"),
	).toBe(true);
	expect(
		parts.some((p: any) => p.type === "text" && p.text === "hello world"),
	).toBe(true);
	expect(parts.at(-1)).toMatchObject({ type: "text", text: "describe it" });
});

// ── extractFields direct tests ───────────────────────────────────────────

test("extractFields recurses into nested ZodObject", () => {
	const schema = z.object({
		name: z.string().meta({ description: "A name" }),
		address: z
			.object({
				city: z.string().meta({ description: "City name" }),
				zip: z.string().meta({ description: "ZIP code" }),
			})
			.meta({ description: "Mailing address" }),
	});

	const fields = extractFields(schema);
	expect(fields).toEqual([
		{ name: "name", description: "A name" },
		{ name: "address", description: "Mailing address" },
		{ name: "address.city", description: "City name" },
		{ name: "address.zip", description: "ZIP code" },
	]);
});

test("extractFields returns empty array for non-object schema", () => {
	const schema = z.string().meta({ description: "just a string" });
	const fields = extractFields(schema);
	expect(fields).toEqual([]);
});

test("extractFields handles arrays of objects gracefully", () => {
	const schema = z.object({
		items: z
			.array(
				z.object({
					id: z.number().meta({ description: "Item ID" }),
				}),
			)
			.meta({ description: "List of items" }),
	});

	const fields = extractFields(schema);
	expect(fields).toEqual([
		{ name: "items", description: "List of items" },
		{ name: "items[*].id", description: "Item ID" },
	]);
});

// ── createSchema tests ───────────────────────────────────────────────────

test("createSchema infers string fields from descriptions", () => {
	const schema = createSchema({
		title: "Project name",
		url: "Source URL",
	});

	const result = schema.parse({ title: "Zugar", url: "https://example.com" });
	expect(result).toEqual({ title: "Zugar", url: "https://example.com" });

	const fields = extractFields(schema);
	expect(fields).toEqual([
		{ name: "title", description: "Project name" },
		{ name: "url", description: "Source URL" },
	]);
});

test("createSchema infers number and boolean fields", () => {
	const schema = createSchema({
		count: 42,
		enabled: true,
	});

	expect(schema.parse({ count: 5, enabled: false })).toEqual({
		count: 5,
		enabled: false,
	});

	const fields = extractFields(schema);
	expect(fields).toEqual([
		{ name: "count", description: "" },
		{ name: "enabled", description: "" },
	]);
});

test("createSchema creates nested objects", () => {
	const schema = createSchema({
		name: "A name",
		address: {
			city: "City name",
			zip: "ZIP code",
		},
	});

	const result = schema.parse({
		name: "Alice",
		address: { city: "Portland", zip: "97201" },
	});
	expect(result).toEqual({
		name: "Alice",
		address: { city: "Portland", zip: "97201" },
	});

	const fields = extractFields(schema);
	expect(fields).toEqual([
		{ name: "name", description: "A name" },
		{ name: "address", description: "" },
		{ name: "address.city", description: "City name" },
		{ name: "address.zip", description: "ZIP code" },
	]);
});

test("createSchema creates arrays from example values", () => {
	const schema = createSchema({
		tags: ["Relevant tag"],
		counts: [42],
	});

	expect(schema.parse({ tags: ["a", "b"], counts: [1, 2, 3] })).toEqual({
		tags: ["a", "b"],
		counts: [1, 2, 3],
	});
});

test("createSchema creates arrays of objects", () => {
	const schema = createSchema({
		items: [{ id: 1, name: "Item name" }],
	});

	const result = schema.parse({
		items: [
			{ id: 1, name: "First" },
			{ id: 2, name: "Second" },
		],
	});
	expect(result.items).toHaveLength(2);
});

test("createSchema works end-to-end with zugar()", async () => {
	const outputSchema = createSchema({
		title: "Project or tool name",
		status: "Pipeline status",
		tags: ["Relevant tag"],
	});

	const mockModel = createMockModel({
		title: "Zugar",
		status: "active",
		tags: ["ai", "typescript"],
	});

	const module = zugar({
		description: "Analyze a project",
		schema: outputSchema,
		model: mockModel,
		inputKind: "text",
	});

	const result = await module({ text: "Some project description" });
	expect(result).toEqual({
		title: "Zugar",
		status: "active",
		tags: ["ai", "typescript"],
	});
});

test("createSchema supports enums", () => {
	const schema = createSchema({
		tone: {
			enum: ["upbeat", "analytical", "urgent", "tutorial"],
			description: "Video tone",
		},
	});

	expect(schema.parse({ tone: "upbeat" })).toEqual({ tone: "upbeat" });
	expect(() => schema.parse({ tone: "invalid" })).toThrow();

	const fields = extractFields(schema);
	expect(fields).toEqual([{ name: "tone", description: "Video tone" }]);
});

test("createSchema supports optional fields", () => {
	const schema = createSchema({
		name: "Required name",
		notes: { optional: true, description: "Optional notes" },
	});

	expect(schema.parse({ name: "Alice" })).toEqual({ name: "Alice" });
	expect(schema.parse({ name: "Alice", notes: "some notes" })).toEqual({
		name: "Alice",
		notes: "some notes",
	});

	const fields = extractFields(schema);
	expect(fields).toEqual([
		{ name: "name", description: "Required name" },
		{ name: "notes", description: "Optional notes" },
	]);
});

test("createSchema supports array min/max constraints", () => {
	const schema = createSchema({
		items: { type: "string[]", description: "Items", min: 1, max: 3 },
	});

	expect(schema.parse({ items: ["a"] })).toEqual({ items: ["a"] });
	expect(schema.parse({ items: ["a", "b", "c"] })).toEqual({
		items: ["a", "b", "c"],
	});
	expect(() => schema.parse({ items: [] })).toThrow();
	expect(() => schema.parse({ items: ["a", "b", "c", "d"] })).toThrow();
});

test("createSchema supports explicit type annotation", () => {
	const schema = createSchema({
		count: { type: "number", description: "A count" },
		enabled: { type: "boolean", description: "Toggle" },
	});

	expect(schema.parse({ count: 5, enabled: true })).toEqual({
		count: 5,
		enabled: true,
	});
});

test("createSchema recreates videoAngleSchema", () => {
	const videoAngleSchema = createSchema({
		name: "Short name for this angle",
		playlist: "Target playlist",
		tone: {
			enum: ["upbeat", "analytical", "urgent", "tutorial"],
			description: "Video tone",
		},
		hook: "1-sentence hook for the video",
		demoFlow: ["Numbered list of what to show in the demo"],
		cta: "Call to action",
	});

	const result = videoAngleSchema.parse({
		name: "Quick Demo",
		playlist: "Neat Shiz",
		tone: "upbeat",
		hook: "Check out this amazing tool",
		demoFlow: ["Show install", "Run basic command"],
		cta: "Star us on GitHub",
	});

	expect(result.tone).toBe("upbeat");
	expect(result.demoFlow).toHaveLength(2);
});

test("createSchema recreates full outputSchema", () => {
	const outputSchema = createSchema({
		title: "Project or tool name",
		sourceUrl: "Primary source URL",
		status: "Pipeline status, e.g. A.ideas (unsorted)",
		playlist: "Playlist name",
		angle: "Video angle summary, e.g. Upbeat — 'How to Easily X'",
		estLength: "Estimated video duration",
		whatIs: "1-2 sentence summary of what this is",
		whyInteresting: ["Key differentiators with numbers/stats"],
		videoAngles: {
			type: "string[]",
			description: "1-3 specific video angle options",
			min: 1,
			max: 3,
		},
		technicalNotes: ["Specs, install instructions, gotchas"],
		competitors: ["Competing or related tools"],
		keyQuote: "One powerful quote from the source",
		demoIdeas: {
			type: "string[]",
			description: "2-4 concrete demo concepts",
			min: 2,
			max: 4,
		},
	});

	const inputSchema = createSchema({
		sources:
			"Combined markdown content from all fetched sources, labeled with URLs",
		userNotes: {
			optional: true,
			description: "User-provided notes or terminal output to incorporate",
		},
		playlist: {
			optional: true,
			description: "Target playlist (default: Neat Shiz)",
		},
	});

	// Output schema parses valid data
	expect(
		outputSchema.parse({
			title: "Zugar",
			sourceUrl: "https://github.com/joemaddalone/zugar",
			status: "A.ideas",
			playlist: "Neat Shiz",
			angle: "Upbeat — How to Easily Build AI Pipelines",
			estLength: "8-10 min",
			whatIs: "A TypeScript library for AI pipelines",
			whyInteresting: ["DSPy-inspired API", "Zero-config prompts"],
			videoAngles: ["Demo the basics"],
			technicalNotes: ["Requires Node 18+"],
			competitors: ["LangChain"],
			keyQuote: "Your schema is your program",
			demoIdeas: ["Show extraction mode", "Show transformation mode"],
		}),
	).toBeTruthy();

	// Input schema works with and without optional fields
	expect(
		inputSchema.parse({
			sources: "# Source 1\nSome content",
		}),
	).toBeTruthy();

	expect(
		inputSchema.parse({
			sources: "# Source 1\nSome content",
			userNotes: "Also check the demo",
			playlist: "AI Tools",
		}),
	).toBeTruthy();
});

test("createSchema supports array of objects with description", () => {
	const schema = createSchema({
		chapters: {
			type: [
				{
					time: "The time in the video that the chapter starts at in the format of mm:ss",
					title:
						"Short chapter title (3-6 words) describing the main topic of this section",
				},
			],
			description:
				"Major topic sections only — typically 3-10 chapters for a tutorial. Not a chapter every 30 seconds.",
		},
	});

	const result = schema.parse({
		chapters: [
			{ time: "0:00", title: "Introduction" },
			{ time: "2:30", title: "Setup" },
		],
	});
	expect(result.chapters).toHaveLength(2);

	const fields = extractFields(schema);
	expect(fields).toEqual([
		{
			name: "chapters",
			description:
				"Major topic sections only — typically 3-10 chapters for a tutorial. Not a chapter every 30 seconds.",
		},
		{
			name: "chapters[*].time",
			description:
				"The time in the video that the chapter starts at in the format of mm:ss",
		},
		{
			name: "chapters[*].title",
			description:
				"Short chapter title (3-6 words) describing the main topic of this section",
		},
	]);
});
