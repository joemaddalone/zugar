import type { SchemaWithDescription, InputKind } from "./types";
import { extractFields } from "./extractFields";

/**
 * Build the user prompt from schema descriptions.
 * The system prompt is simply `description`.
 */
export const buildUserPrompt = (
  inputKind: InputKind,
  inputSchema: SchemaWithDescription | undefined,
  outputSchema: SchemaWithDescription,
  inputData?: Record<string, unknown>,
  context?: string,
): string => {
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
  lines.push(
    "Respond with ONLY the JSON object. Do not include markdown or explanations.",
  );

  return lines.join("\n");
};
