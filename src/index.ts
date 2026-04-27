import { generateText, Output, type LanguageModel, type ImagePart, type TextPart } from "ai";
import { z } from "zod";

type SchemaWithDescription = z.ZodTypeAny & { description?: string };


export type InputKind = "text" | "image" | "multimodal" | "schema";

export type ZugarConfig<
  TInputSchema extends z.ZodTypeAny | undefined,
  TOutputSchema extends z.ZodTypeAny,
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
  TInputSchema extends z.ZodTypeAny | undefined,
  TOutputSchema extends z.ZodTypeAny,
> = {
  schema: TOutputSchema;
  description: string;
  /**
   * Call the module.
   * - If inputSchema is provided, input must match it.
   * - Otherwise input is { text?, image?, context? }.
   */
  (input: TInputSchema extends z.ZodTypeAny
    ? { data: z.infer<TInputSchema>; context?: string }
    : { text?: string; image?: string; context?: string }): Promise<z.infer<TOutputSchema>>;
};

export function someModelsJustWontFuckingListen(text: string): unknown {
  // Strip markdown code blocks: ```json ... ``` or ``` ... ```
  const withoutMarkdown = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/,
    "");

  return JSON.parse(withoutMarkdown);
}

/**
 * Extract field info from a Zod object schema.
 * Reads .description set by .meta({ description: "..." }) or .describe("...").
 */
function extractFields(schema: z.ZodTypeAny): Array<{ name: string; description: string }> {
  const fields: Array<{ name: string; description: string }> = [];

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const desc = (fieldSchema as SchemaWithDescription).description ?? "";
      fields.push({ name: key, description: desc });
    }
  }

  return fields;
}

/**
 * Build the user prompt from schema descriptions.
 * The system prompt is simply `description`.
 */
function buildUserPrompt(
  inputKind: InputKind,
  inputSchema: z.ZodTypeAny | undefined,
  outputSchema: z.ZodTypeAny,
  inputData?: Record<string, unknown>,
  context?: string,
): string {
  const lines: string[] = [];

  if (inputKind === "schema" && inputSchema) {
    const inputFields = extractFields(inputSchema);
    const outputFields = extractFields(outputSchema);

    lines.push("Input fields:");
    for (const f of inputFields) {
      lines.push(`  ${f.name}: ${f.description}`);
    }
    lines.push("");

    lines.push("Input data:");
    for (const f of inputFields) {
      const value = inputData?.[f.name];
      lines.push(`  ${f.name}: ${value ?? "(empty)"}`);
    }
    lines.push("");

    lines.push("Output fields:");
    for (const f of outputFields) {
      lines.push(`  ${f.name}: ${f.description}`);
    }
  } else {
    const outputFields = extractFields(outputSchema);

    lines.push("Return a JSON object with these EXACT keys:");
    for (const f of outputFields) {
      lines.push(`  ${f.name}: ${f.description}`);
    }
    lines.push("");

    if (inputKind === "image") {
      lines.push("Analyze the provided image and extract all fields.");
    } else if (inputKind === "text") {
      lines.push("Analyze the provided text and extract all fields.");
    } else {
      lines.push("Analyze the provided content and extract all fields.");
    }
  }

  if (context) {
    lines.push(`\nPrevious context: ${context}`);
  }

  lines.push("");
  lines.push("Respond with ONLY the JSON object. Do not include markdown or explanations.");

  return lines.join("\n");
}

export function zugar<
  TInputSchema extends z.ZodTypeAny | undefined,
  TOutputSchema extends z.ZodTypeAny,
>(config: ZugarConfig<TInputSchema, TOutputSchema>): ZugarModule<TInputSchema, TOutputSchema> {
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
    const contentParts: Array<TextPart | ImagePart> = [{ type: "text", text: userPrompt }];

    if (inputKind === "image" && typedInput.image) {
      contentParts.push({ type: "image", image: typedInput.image } as ImagePart);
    } else if (inputKind === "multimodal") {
      if (typedInput.image) contentParts.push({ type: "image", image: typedInput.image } as ImagePart);
      if (typedInput.text) contentParts.push({ type: "text", text: typedInput.text });
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
        messages: [
          { role: "system", content: config.description },
          { role: "user", content: contentParts },
        ],
      });
      output = result.output;
    } catch (e: unknown) {
      // Some models wrap JSON in markdown blocks — strip and retry
      if (e && typeof e === "object" && "text" in e && typeof (e as { text: unknown }).text === "string") {
        const errWithText = e as { text: string };
        output = someModelsJustWontFuckingListen(errWithText.text);
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
