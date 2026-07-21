export const someModelsJustWontFuckingListen = (text: string): unknown => {
	// Strip markdown code blocks: ```json ... ``` or ``` ... ```
	const withoutMarkdown = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");

	try {
		return JSON.parse(withoutMarkdown);
	} catch {
		throw new Error(
			`Failed to parse LLM response as JSON: ${withoutMarkdown.slice(0, 200)}`,
		);
	}
};
