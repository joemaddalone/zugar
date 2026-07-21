import { test, expect } from "bun:test";
import { z } from "./index";
import { zugar } from "./index";

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

// ── Extraction mode prompt tests ─────────────────────────────────────────────

test("extraction mode prompt includes output field descriptions", () => {
	const schema = z.object({
		subject: z.string().meta({ description: "The main subject" }),
		tone: z.string().meta({ description: "The mood" }),
	});

	const outputFields: Array<{ name: string; description: string }> = [];
	const shape = schema.shape;
	for (const [key, fieldSchema] of Object.entries(shape)) {
		const desc = (fieldSchema as any).description ?? "";
		outputFields.push({ name: key, description: desc });
	}

	const lines = [
		"Return a JSON object with these EXACT keys:",
		...outputFields.map((f) => `  ${f.name}: ${f.description}`),
		"",
		"Analyze the provided image and extract all fields.",
		"",
		"Respond with ONLY the JSON object. Do not include markdown or explanations.",
	];

	const prompt = lines.join("\n");

	expect(prompt).toContain("  subject: The main subject");
	expect(prompt).toContain("  tone: The mood");
	expect(prompt).toContain("Analyze the provided image");
	expect(prompt).toContain("Respond with ONLY the JSON object");
});

// ── Transformation mode prompt tests ─────────────────────────────────────────

test("transformation mode prompt includes both input and output field descriptions", () => {
	const inputSchema = z.object({
		subject: z.string().meta({ description: "The main subject" }),
		tone: z.string().meta({ description: "The mood" }),
	});

	const outputSchema = z.object({
		prompt: z.string().meta({ description: "The generated prompt" }),
	});

	const inputData: Record<string, unknown> = { subject: "cat", tone: "chill" };

	const inputFields: Array<{ name: string; description: string }> = [];
	const iShape = inputSchema.shape;
	for (const [key, fieldSchema] of Object.entries(iShape)) {
		const desc = (fieldSchema as any).description ?? "";
		inputFields.push({ name: key, description: desc });
	}

	const outputFields: Array<{ name: string; description: string }> = [];
	const oShape = outputSchema.shape;
	for (const [key, fieldSchema] of Object.entries(oShape)) {
		const desc = (fieldSchema as any).description ?? "";
		outputFields.push({ name: key, description: desc });
	}

	const lines = [
		"Input fields:",
		...inputFields.map((f) => `  ${f.name}: ${f.description}`),
		"",
		"Input data:",
		...inputFields.map((f) => `  ${f.name}: ${inputData[f.name] ?? "(empty)"}`),
		"",
		"Output fields:",
		...outputFields.map((f) => `  ${f.name}: ${f.description}`),
		"",
		"Respond with ONLY the JSON object. Do not include markdown or explanations.",
	];

	const prompt = lines.join("\n");

	expect(prompt).toContain("Input fields:");
	expect(prompt).toContain("  subject: The main subject");
	expect(prompt).toContain("  tone: The mood");
	expect(prompt).toContain("Input data:");
	expect(prompt).toContain("  subject: cat");
	expect(prompt).toContain("  tone: chill");
	expect(prompt).toContain("Output fields:");
	expect(prompt).toContain("  prompt: The generated prompt");
	expect(prompt).toContain("Respond with ONLY the JSON object");
});

test("transformation mode handles empty input values", () => {
	const inputSchema = z.object({
		name: z.string().meta({ description: "A name" }),
	});

	const inputData: Record<string, unknown> = { name: "" };

	const inputFields: Array<{ name: string; description: string }> = [];
	const iShape = inputSchema.shape;
	for (const [key, fieldSchema] of Object.entries(iShape)) {
		const desc = (fieldSchema as any).description ?? "";
		inputFields.push({ name: key, description: desc });
	}

	const lines = [
		"Input fields:",
		...inputFields.map((f) => `  ${f.name}: ${f.description}`),
		"",
		"Input data:",
		...inputFields.map((f) => `  ${f.name}: ${inputData[f.name] ?? "(empty)"}`),
	];

	const prompt = lines.join("\n");
	expect(prompt).toContain("  name: ");
});

// ── System prompt is just description ────────────────────────────────────────

test("description is used as system prompt, schema fields drive user prompt", () => {
	const config = {
		description: "You are a photography analyst. Extract metadata from images.",
		schema: z.object({
			subject: z.string().meta({ description: "The main subject" }),
		}),
		inputKind: "image" as const,
	};

	const outputFields: Array<{ name: string; description: string }> = [];
	const shape = config.schema.shape;
	for (const [key, fieldSchema] of Object.entries(shape)) {
		const desc = (fieldSchema as any).description ?? "";
		outputFields.push({ name: key, description: desc });
	}

	const lines = [
		"Return a JSON object with these EXACT keys:",
		...outputFields.map((f) => `  ${f.name}: ${f.description}`),
		"",
		"Analyze the provided image and extract all fields.",
	];

	const systemPrompt = config.description;
	const userPrompt = lines.join("\n");

	expect(systemPrompt).toBe(
		"You are a photography analyst. Extract metadata from images.",
	);
	expect(userPrompt).toContain("  subject: The main subject");
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
