import {
	generateText,
	transcribe,
	Output,
	type FilePart,
	type TextPart,
} from "ai";
import { z } from "zod";
import type {
	SchemaWithDescription,
	ZugarConfig,
	ZugarModule,
	FileWriter,
} from "./types";
import { buildUserPrompt } from "./buildUserPrompt";
import { someModelsJustWontFuckingListen } from "./someModelsJustWontFuckingListen";

export function inferMediaType(
	data: unknown,
	fallback: string = "image/png",
): string {
	if (typeof data === "string") {
		if (data.startsWith("data:")) {
			const match = data.match(/^data:([^;]+)/);
			if (match?.[1]) return match[1];
		}
	}
	return fallback;
}

export function zugar<
	TInputSchema extends SchemaWithDescription | undefined = undefined,
	TOutputSchema extends SchemaWithDescription = SchemaWithDescription,
>(
	config: ZugarConfig<TInputSchema, TOutputSchema>,
): ZugarModule<TInputSchema, TOutputSchema> {
	const inputKind =
		config.inputKind ?? (config.inputSchema ? "schema" : "text");

	// Shared runtime input shape — TS can't narrow conditional types at runtime,
	// so we use this union and cast at the boundary.
	type RuntimeInput = {
		data?: unknown;
		text?: string;
		image?: string;
		audio?: string | Uint8Array | ArrayBuffer | Buffer | URL;
		context?: string;
		fileWriter?: FileWriter<z.infer<TOutputSchema>>;
	};

	async function module(input: RuntimeInput): Promise<unknown> {
		const typedInput = input as RuntimeInput & {
			data?: Record<string, unknown>;
			text?: string;
			image?: string;
			audio?: string | Uint8Array | ArrayBuffer | Buffer | URL;
			context?: string;
			fileWriter?: FileWriter<z.infer<TOutputSchema>>;
		};

		switch (inputKind) {
			case "text":
				if (!typedInput.text) {
					throw new Error(
						'inputKind "text" requires a "text" property on the input',
					);
				}
				break;
			case "image":
				if (!typedInput.image) {
					throw new Error(
						'inputKind "image" requires an "image" property on the input',
					);
				}
				break;
			case "audio":
				if (!typedInput.audio) {
					throw new Error(
						'inputKind "audio" requires an "audio" property on the input',
					);
				}
				break;
			case "multimodal":
				if (!typedInput.text && !typedInput.image && !typedInput.audio) {
					throw new Error(
						'inputKind "multimodal" requires at least one of "text", "image", or "audio" on the input',
					);
				}
				break;
			case "schema":
				if (!("data" in typedInput) || typedInput.data === undefined) {
					throw new Error(
						'inputKind "schema" requires a "data" property on the input',
					);
				}
				break;
		}

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
			throw new Error("When inputSchema is provided, pass { data: <object> }");
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
				mediaType: inferMediaType(typedInput.image),
			});
		} else if (inputKind === "audio" && typedInput.audio) {
			if (config.transcriptionModel) {
				// Transcribe audio to text via the /v1/audio/transcriptions endpoint,
				// then feed the transcript to the language model as text.
				const transcript = await transcribe({
					model: config.transcriptionModel,
					audio: typedInput.audio,
					providerOptions: config.providerOptions,
				});
				contentParts.push({ type: "text", text: transcript.text });
			} else {
				contentParts.push({
					type: "file",
					data: typedInput.audio,
					mediaType: inferMediaType(typedInput.audio, "audio/wav"),
				});
			}
		} else if (inputKind === "multimodal") {
			if (typedInput.image)
				contentParts.push({
					type: "file",
					data: typedInput.image,
					mediaType: inferMediaType(typedInput.image),
				});
			if (typedInput.audio) {
				if (config.transcriptionModel) {
					const transcript = await transcribe({
						model: config.transcriptionModel,
						audio: typedInput.audio,
						providerOptions: config.providerOptions,
					});
					contentParts.push({ type: "text", text: transcript.text });
				} else {
					contentParts.push({
						type: "file",
						data: typedInput.audio,
						mediaType: inferMediaType(typedInput.audio, "audio/wav"),
					});
				}
			}
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

		const validatedOutput = output as z.infer<TOutputSchema>;
		if (typedInput.fileWriter) await typedInput.fileWriter(validatedOutput);

		return validatedOutput;
	}

	module.schema = config.schema;
	module.inputSchema = config.inputSchema;
	module.description = config.description;

	return module as unknown as ZugarModule<TInputSchema, TOutputSchema>;
}

export type {
	SchemaWithDescription,
	ZugarConfig,
	ZugarModule,
	FileWriter,
} from "./types";
export { z, Output };
export { createSchema } from "./createSchema";
export { transcribeAudio } from "./transcribeAudio";
export type { TranscriptionResult } from "./transcribeAudio";
