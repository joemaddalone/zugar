import type { SchemaWithDescription } from "./types";
import { z } from "zod";

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
			const desc = (fieldSchema as SchemaWithDescription).description ?? "";

			if (fieldSchema instanceof z.ZodObject) {
				fields.push({ name: fullName, description: desc });
				fields.push(...extractFields(fieldSchema, fullName));
			} else {
				fields.push({ name: fullName, description: desc });
			}
		}
	}

	return fields;
};
