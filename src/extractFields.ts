import type { SchemaWithDescription } from "./types";
import { z } from "zod";

/**
 * Extract field info from a Zod object schema.
 * Reads .description set by .meta({ description: "..." }) or .describe("...").
 */
export const extractFields = (
  schema: SchemaWithDescription,
): Array<{ name: string; description: string }> => {
  const fields: Array<{ name: string; description: string }> = [];

  if (schema instanceof z.ZodObject) {
    const shape = schema.shape;
    for (const [key, fieldSchema] of Object.entries(shape)) {
      const desc = (fieldSchema as SchemaWithDescription).description ?? "";
      fields.push({ name: key, description: desc });
    }
  }

  return fields;
};
