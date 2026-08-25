import { describe, test, expect, mock, beforeEach } from "bun:test";
import * as ai from "ai";

let fakeTranscribeCalls: any[] = [];

mock.module("ai", () => ({
	...ai,
	transcribe: async (opts: any) => {
		fakeTranscribeCalls.push(opts);
		return { text: "stub transcript", durationSeconds: 2, language: "en" };
	},
}));

// Import AFTER mock.module so the wrapper binds the stubbed transcribe.
const { transcribeAudio } = await import("./transcribeAudio");

describe("transcribeAudio", () => {
	beforeEach(() => {
		fakeTranscribeCalls = [];
	});

	test("passes model, audio, providerOptions through", async () => {
		const result = await transcribeAudio({
			model: { specificationVersion: "v1" } as any,
			audio: "data:audio/wav;base64,UklGRg==",
			providerOptions: { openai: { language: "en" } },
		});

		expect(result.text).toBe("stub transcript");
		expect(fakeTranscribeCalls).toHaveLength(1);
		expect(fakeTranscribeCalls[0].audio).toBe("data:audio/wav;base64,UklGRg==");
		expect(fakeTranscribeCalls[0].providerOptions).toEqual({
			openai: { language: "en" },
		});
	});
});
