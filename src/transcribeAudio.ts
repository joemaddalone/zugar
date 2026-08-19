import {
	transcribe,
	type TranscriptionModel,
	type TranscriptionResult,
} from "ai";

import type { ProviderOptions } from "./types";

/**
 * Transcribe audio using a transcription model (e.g. openai.transcription("whisper-1")).
 * This hits the provider's /audio/transcriptions endpoint.
 *
 * @example
 * ```ts
 * import { createOpenAI } from "@ai-sdk/openai";
 * import { transcribeAudio } from "zugar";
 *
 * const openai = createOpenAI({ apiKey: process.env.OPENAI_API_KEY });
 * const result = await transcribeAudio({
 *   model: openai.transcription("whisper-1"),
 *   audio: "data:audio/wav;base64,UklGR...",
 * });
 * console.log(result.text); // transcribed text
 * ```
 */
export async function transcribeAudio(options: {
	/** The transcription model to use (e.g. openai.transcription("whisper-1")) */
	model: TranscriptionModel;
	/** Audio data as a data URL, Uint8Array, ArrayBuffer, Buffer, or URL */
	audio: string | Uint8Array | ArrayBuffer | Buffer | URL;
	/** Optional provider-specific options (e.g. temperature, language, response_format) */
	providerOptions?: ProviderOptions;
	/** Abort signal for cancellation */
	abortSignal?: AbortSignal;
}): Promise<TranscriptionResult> {
	return transcribe({
		model: options.model,
		audio: options.audio,
		providerOptions: options.providerOptions,
		abortSignal: options.abortSignal,
	});
}

export type { TranscriptionResult } from "ai";
