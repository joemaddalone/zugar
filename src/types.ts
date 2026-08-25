import type { LanguageModel, TranscriptionModel } from "ai";
import type { z, ZodTypeAny } from "zod";

type JSONValue = null | string | number | boolean | JSONObject | JSONArray;
type JSONObject = {
	[key: string]: JSONValue | undefined;
};
type JSONArray = JSONValue[];

export type ProviderOptions = Record<string, JSONObject>;
export type SchemaWithDescription = ZodTypeAny & { description?: string };

export type InputKind = "text" | "image" | "audio" | "multimodal" | "schema";

export type ZugarConfig<
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny,
> = {
	// What this module does — used as the system prompt
	description: string;
	// Output schema — use .meta({ description: "..." }) for field descriptions
	schema: TOutputSchema;
	// Optional input schema — same .meta() pattern
	inputSchema?: TInputSchema;
	model: LanguageModel;
	inputKind?: InputKind;
	/**
	 * Transcription model for audio input kind.
	 * When provided with inputKind: "audio", audio is transcribed to text
	 * before being sent to the language model for structured extraction.
	 */
	transcriptionModel?: TranscriptionModel;
	temperature?: number;
	maxTokens?: number;
	/**
	 * Provider-specific options for the transcription model call.
	 * (e.g. { openai: { language: "en", temperature: 0 } }).
	 */
	providerOptions?: ProviderOptions;
};

export type ZugarModule<
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny,
> = {
	schema: TOutputSchema;
	description: string;
} & ([TInputSchema] extends [ZodTypeAny]
	? (input: {
			data: z.infer<TInputSchema>;
			context?: string;
		}) => Promise<z.infer<TOutputSchema>>
	: (input: {
			text?: string;
			image?: string;
			audio?: string | Uint8Array | ArrayBuffer | Buffer | URL;
			context?: string;
		}) => Promise<z.infer<TOutputSchema>>);
