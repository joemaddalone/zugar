export const someModelsJustWontFuckingListen = (text: string): unknown => {
	// Strip markdown code blocks: ```json ... ``` or ``` ... ```
	const withoutMarkdown = text
		.replace(/^```(?:json)?\s*/i, "")
		.replace(/\s*```$/, "");

	return JSON.parse(withoutMarkdown);
};
