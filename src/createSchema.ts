import { z, type ZodObject, type ZodTypeAny } from "zod";

// ── Input types ───────────────────────────────────────────────────────────

interface FieldSchema {
	type?:
		| "string"
		| "number"
		| "boolean"
		| "string[]"
		| "number[]"
		| SchemaInput[];
	description?: string;
	enum?: string[];
	optional?: boolean;
	min?: number;
	max?: number;
}

type SchemaValue =
	| string
	| number
	| boolean
	| FieldSchema
	| SchemaInput
	| SchemaValue[]
	| (string | number | boolean)[];

interface SchemaInput {
	[key: string]: SchemaValue;
}

// ── Runtime implementation ────────────────────────────────────────────────

function buildBaseField(type?: string): ZodTypeAny {
	switch (type) {
		case "number":
			return z.number();
		case "boolean":
			return z.boolean();
		case "number[]":
			return z.array(z.number());
		case "string[]":
			return z.array(z.string());
		default:
			return z.string();
	}
}

function buildField(value: unknown): ZodTypeAny {
	// Plain string → z.string() with description
	if (typeof value === "string") return z.string().meta({ description: value });
	// Plain number/boolean → inferred type
	if (typeof value === "number") return z.number();
	if (typeof value === "boolean") return z.boolean();
	// Plain array → z.array() with item type from first element
	if (Array.isArray(value)) {
		if (value.length === 0) return z.array(z.unknown());
		return z.array(buildField(value[0]));
	}
	// Plain object → nested z.object()
	if (typeof value === "object" && value !== null && !isFieldSchema(value)) {
		return createSchema(value as SchemaInput);
	}
	// FieldSchema object → structured definition
	if (typeof value === "object" && value !== null && isFieldSchema(value)) {
		return buildFieldSchema(value);
	}
	return z.unknown();
}

function isFieldSchema(value: object): value is FieldSchema {
	return (
		"enum" in value ||
		"type" in value ||
		"optional" in value ||
		"description" in value
	);
}

function buildFieldSchema(field: FieldSchema): ZodTypeAny {
	let field_: ZodTypeAny;

	// Enum
	if (field.enum) {
		field_ = z.enum(field.enum as [string, ...string[]]);
	}
	// Array of objects — type is an array of SchemaInput
	else if (Array.isArray(field.type)) {
		const itemSchema =
			field.type.length > 0 ? buildField(field.type[0]) : z.unknown();
		field_ = z.array(itemSchema);
	}
	// Primitive or array of primitives
	else {
		field_ = buildBaseField(field.type);
	}

	// Description
	if (field.description) {
		field_ = field_.meta({ description: field.description });
	}

	// Array constraints
	if (field_.constructor.name === "ZodArray") {
		let arr = field_ as z.ZodArray<ZodTypeAny>;
		if (field.min !== undefined) arr = arr.min(field.min);
		if (field.max !== undefined) arr = arr.max(field.max);
		field_ = arr;
	}

	// Optional
	if (field.optional) {
		field_ = field_.optional();
	}

	return field_;
}

/**
 * Create a ZodObject schema from a plain JSON description.
 *
 * Simple values:
 * - `"description"` → `z.string()` with description
 * - `42` → `z.number()`
 * - `true` → `z.boolean()`
 * - `["item"]` → `z.array(z.string())`
 * - `{ nested: "desc" }` → nested `z.object()`
 *
 * FieldSchema objects for advanced control:
 * - `{ enum: ["a", "b"], description: "..." }` → `z.enum()`
 * - `{ type: "number", optional: true }` → `z.number().optional()`
 * - `{ type: "string[]", min: 1, max: 3 }` → `z.array(z.string()).min(1).max(3)`
 */
export function createSchema<T extends SchemaInput>(
	definition: T,
): ZodObject<Record<string, ZodTypeAny>> {
	const shape: Record<string, ZodTypeAny> = {};

	for (const [key, value] of Object.entries(definition)) {
		shape[key] = buildField(value);
	}

	return z.object(shape);
}
