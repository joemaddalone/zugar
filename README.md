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
```

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

## License

MIT
