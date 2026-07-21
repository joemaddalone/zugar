import type { SchemaWithDescription } from "./types";
import { z } from "zod";

// biome-ignore lint/suspicious/noExplicitAny: Zod v4 uses incompatible internal types
function unwrap(fieldSchema: any): any {
	if (fieldSchema instanceof z.ZodOptional) {
		return unwrap(fieldSchema._def.innerType);
	}
	if (fieldSchema instanceof z.ZodDefault) {
		return unwrap(fieldSchema._def.innerType);
	}
	return fieldSchema;
}

/**
 * Extract field info from a Zod object schema.
 * Reads .description set by .meta({ description: "..." }) or .describe("...").
 */
export const extractFields = (
	schema: SchemaWithDescription,
	prefix = "",
): Array<{ name: string; description: string }> => {
	const fields: Array<{ name: string; description: string }> = [];

	if (schema instanceof z.ZodObject) {
		const shape = schema.shape;
		for (const [key, fieldSchema] of Object.entries(shape)) {
			const fullName = prefix ? `${prefix}.${key}` : key;
			const inner = unwrap(fieldSchema as z.ZodTypeAny);
			const desc = (inner as SchemaWithDescription).description ?? "";

			if (inner instanceof z.ZodObject) {
				fields.push({ name: fullName, description: desc });
				fields.push(...extractFields(inner, fullName));
			} else {
				fields.push({ name: fullName, description: desc });
			}
		}
	}

	return fields;
};
