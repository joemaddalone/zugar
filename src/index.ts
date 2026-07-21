import { generateText, Output, type FilePart, type TextPart } from "ai";
import { z } from "zod";
import type { SchemaWithDescription, ZugarConfig, ZugarModule } from "./types";
import { buildUserPrompt } from "./buildUserPrompt";
import { someModelsJustWontFuckingListen } from "./someModelsJustWontFuckingListen";

export function zugar<
	TInputSchema extends SchemaWithDescription | undefined,
	TOutputSchema extends SchemaWithDescription,
>(
	config: ZugarConfig<TInputSchema, TOutputSchema>,
): ZugarModule<TInputSchema, TOutputSchema> {
	const inputKind = config.inputKind ?? "text";

	// Shared runtime input shape — TS can't narrow conditional types at runtime,
	// so we use this union and cast at the boundary.
	type RuntimeInput = {
		data?: unknown;
		text?: string;
		image?: string;
		context?: string;
	};

	async function module(input: RuntimeInput): Promise<unknown> {
		const typedInput = input as RuntimeInput & {
			data?: Record<string, unknown>;
			text?: string;
			image?: string;
			context?: string;
		};

		// Validate input against inputSchema if provided
		let inputData: Record<string, unknown> | undefined;

		if (config.inputSchema && "data" in typedInput && typedInput.data) {
			const parsed = config.inputSchema.safeParse(typedInput.data);
			if (!parsed.success) {
				throw new Error(`Input validation failed: ${parsed.error.message}`);
			}
			inputData = parsed.data as Record<string, unknown>;
		} else if (!config.inputSchema) {
			// Extraction mode — no input validation needed
		} else {
			throw new Error(
				config.inputSchema
					? "When inputSchema is provided, pass { data: <object> }"
					: "When no inputSchema is provided, pass { text?, image?, context? }",
			);
		}

		const userPrompt = buildUserPrompt(
			inputKind,
			config.inputSchema,
			config.schema,
			inputData,
			typedInput.context,
		);

		// Build messages
		const contentParts: Array<TextPart | FilePart> = [
			{ type: "text", text: userPrompt },
		];

		if (inputKind === "image" && typedInput.image) {
			contentParts.push({
				type: "file",
				data: typedInput.image,
				mediaType: "image",
			});
		} else if (inputKind === "multimodal") {
			if (typedInput.image)
				contentParts.push({
					type: "file",
					data: typedInput.image,
					mediaType: "image",
				});
			if (typedInput.text)
				contentParts.push({ type: "text", text: typedInput.text });
		} else if (inputKind === "text" && typedInput.text) {
			contentParts.push({ type: "text", text: typedInput.text });
		}

		let output: unknown;

		try {
			const result = await generateText({
				model: config.model,
				temperature: config.temperature ?? 0.7,
				maxOutputTokens: config.maxTokens ?? 8192,
				output: Output.object({ schema: config.schema }),
				system: config.description,
				messages: [{ role: "user", content: contentParts }],
			});
			output = result.output;
		} catch (e: unknown) {
			// Some models wrap JSON in markdown blocks — strip and retry
			if (
				e &&
				typeof e === "object" &&
				"text" in e &&
				typeof (e as { text: unknown }).text === "string"
			) {
				const errWithText = e as { text: string };
				const parsed = someModelsJustWontFuckingListen(errWithText.text);
				const result = config.schema.safeParse(parsed);
				if (!result.success) {
					throw new Error(
						`LLM response did not match output schema: ${result.error.message}`,
					);
				}
				output = result.data;
			} else {
				throw e;
			}
		}

		return output as z.infer<TOutputSchema>;
	}

	module.schema = config.schema;
	module.inputSchema = config.inputSchema;
	module.description = config.description;

	return module as unknown as ZugarModule<TInputSchema, TOutputSchema>;
}

export { z, Output };
