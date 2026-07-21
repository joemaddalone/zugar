# Zugar

Zugar is a TypeScript library for building AI-powered pipelines with a DSPy-inspired API. Define your data with Zod schemas, and Zugar handles prompt generation, LLM calls, and structured output — all with full type safety.

## Features

- **Zod v4 `.meta()` descriptions** — your schema *is* the program. No more duplicating field descriptions in prompt strings.
- **Two modes** — extraction (raw input → structured output) and transformation (structured input → structured output).
- **Multimodal support** — text, image, and multimodal inputs out of the box.
- **Full type safety** — input and output types are inferred from your Zod schemas.
- **Zero config prompts** — Zugar builds the user prompt from your schema's `.meta()` descriptions automatically.

## Installation

```bash
npm install zugar
# or
bun add zugar
```

## Input Kinds

| `inputKind` | Use case | Input shape |
|---|---|---|
| `"text"` | Extract from text | `{ text: string }` |
| `"image"` | Extract from base64 image | `{ image: string }` |
| `"multimodal"` | Combine text + image | `{ text?: string; image?: string }` |
| `"schema"` | Transform structured data | `{ data: T }` |

All modes accept an optional `context: string` for cross-module continuity.

## Quick Start

### Extraction Mode

Turn unstructured input into structured data:

```typescript
import { zugar, z } from "zugar";
import { createOpenAI } from "@ai-sdk/openai";

const PhotoSchema = z.object({
  subject: z.string().meta({ description: "The main subject" }),
  style: z.string().meta({ description: "The art style" }),
  tone: z.string().meta({ description: "The mood or tone" }),
});

const PhotoReader = zugar({
  description: "Analyze a photograph and extract structured metadata.",
  schema: PhotoSchema,
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })("gpt-4o"),
  inputKind: "image",
});

const result = await PhotoReader({ image: base64Image });
// result is fully typed as { subject: string; style: string; tone: string }
```

### Transformation Mode

Chain modules — feed the output of one into the next:

```typescript
const PromptSchema = z.object({
  prompt: z.string().meta({ description: "The generated image prompt" }),
});

const PromptWriter = zugar({
  description: "Generate an image generation prompt from photo analysis.",
  inputSchema: PhotoSchema,
  schema: PromptSchema,
  model: createOpenAI({ apiKey: process.env.OPENAI_API_KEY })("gpt-4o"),
  inputKind: "schema",
});

// Pipeline: extract → transform
const analysis = await PhotoReader({ image: base64Image });
const { prompt } = await PromptWriter({ data: analysis });
```

### Schema Shorthand (experimental)

Use `createSchema` to build Zod schemas from plain JSON — string values become descriptions, objects become nested schemas, arrays indicate array fields:

```typescript
import { zugar, createSchema } from "zugar";

const outputSchema = createSchema({
  title: "Project name",
  tags: ["Relevant tag"],
  nested: { field: "Description" },
});

const module = zugar({
  description: "Analyze a project",
  schema: outputSchema,
  model: myModel,
  inputKind: "text",
});
```

#### Field types

| Input | Zod output |
|---|---|
| `"description"` | `z.string().meta({ description })` |
| `42` | `z.number()` |
| `true` | `z.boolean()` |
| `["item"]` | `z.array(z.string())` |
| `{ field: "desc" }` | nested `z.object()` |

#### Advanced fields

Use a `FieldSchema` object for enums, optional fields, and array constraints:

```typescript
const schema = createSchema({
  // Enum
  tone: {
    enum: ["upbeat", "analytical", "urgent", "tutorial"],
    description: "Video tone",
  },

  // Optional
  notes: { optional: true, description: "User notes" },

  // Array with constraints
  demoIdeas: {
    type: "string[]",
    description: "2-4 concrete demo concepts",
    min: 2,
    max: 4,
  },

  // Explicit type
  count: { type: "number", description: "Item count" },
});
```

#### FieldSchema options

| Property | Type | Description |
|---|---|---|
| `type` | `"string" \| "number" \| "boolean" \| "string[]" \| "number[]"` | Explicit type (inferred for simple values) |
| `description` | `string` | Field description for the LLM prompt |
| `enum` | `string[]` | Restrict to listed values |
| `optional` | `boolean` | Allow `undefined` |
| `min` | `number` | Minimum array length |
| `max` | `number` | Maximum array length |

## License

MIT
