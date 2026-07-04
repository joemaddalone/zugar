import type { LanguageModel } from "ai";
import type { ZodTypeAny } from "zod";

export type SchemaWithDescription = ZodTypeAny & { description?: string };

export type InputKind = "text" | "image" | "multimodal" | "schema";

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
	temperature?: number;
	maxTokens?: number;
};

export type ZugarModule<
	TInputSchema extends ZodTypeAny | undefined,
	TOutputSchema extends ZodTypeAny,
> = {
	schema: TOutputSchema;
	description: string;
	/**
	 * Call the module.
	 * - If inputSchema is provided, input must match it.
	 * - Otherwise input is { text?, image?, context? }.
	 */
	(
		input: TInputSchema extends ZodTypeAny
			? {
					data: TInputSchema extends ZodTypeAny ? TInputSchema : never;
					context?: string;
				}
			: { text?: string; image?: string; context?: string },
	): Promise<TOutputSchema extends ZodTypeAny ? TOutputSchema : never>;
};
