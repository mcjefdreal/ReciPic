import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { OPENROUTER_API_KEY } from "$env/static/private";

const OpenRouterAPIURL = "https://openrouter.ai/api/v1/chat/completions";
const Model = "qwen/qwen3.6-flash";

interface Ingredient {
	name: string;
	count: number;
}

interface IngredientAnalysis {
	ingredients: Ingredient[];
}

interface OpenRouterRequest {
	model: string;
	messages: Message[];
	temperature?: number;
	max_tokens?: number;
	provider?: ProviderOpts;
}

interface ProviderOpts {
	order?: string[];
}

interface Message {
	role: string;
	content: ContentItem[];
}

interface TextContent {
	type: "text";
	text: string;
}

interface ImageContent {
	type: "image_url";
	image_url: {
		url: string;
	};
}

type ContentItem = TextContent | ImageContent;

interface OpenRouterResponse {
	choices: {
		message: {
			content: string;
		};
	}[];
	usage?: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	error?: {
		message: string;
		code: number;
	};
}

function extractJSON(content: string): string {
	const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
	if (jsonMatch) {
		return jsonMatch[1].trim();
	}

	const codeMatch = content.match(/```\s*([\s\S]*?)```/);
	if (codeMatch) {
		return codeMatch[1].trim();
	}

	return content.trim();
}

export const POST: RequestHandler = async ({ request }) => {
	if (!OPENROUTER_API_KEY) {
		throw error(500, "OPENROUTER_API_KEY not configured");
	}

	try {
		const formData = await request.formData();
		const imageFile = formData.get("image") as File | null;

		if (!imageFile) {
			throw error(400, "No image provided");
		}

		// Convert image to base64
		const arrayBuffer = await imageFile.arrayBuffer();
		const base64Image = Buffer.from(arrayBuffer).toString("base64");
		const dataURL = `data:${imageFile.type};base64,${base64Image}`;

		const prompt = `List ingredients in this image. Use GENERAL names only (tomato, not roma tomato).

STRICT RULES:
- Max 10 ingredients
- JSON ONLY, no explanation
- 1 word names only

OUTPUT:
{"ingredients":[{"name":"tomato","count":3},{"name":"onion","count":1}]}`;

		const content: ContentItem[] = [
			{ type: "text", text: prompt },
			{
				type: "image_url",
				image_url: { url: dataURL },
			},
		];

		const reqBody: OpenRouterRequest = {
			model: Model,
			messages: [{ role: "user", content: content }],
			temperature: 0.0,
			max_tokens: 256,
			provider: { order: ["Novita", "DeepInfra", "Fireworks", "Hyperbolic"] },
		};

		const response = await fetch(OpenRouterAPIURL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${OPENROUTER_API_KEY}`,
				"Content-Type": "application/json",
				"HTTP-Referer": "https://recipic.app",
				"X-Title": "ReciPic",
			},
			body: JSON.stringify(reqBody),
		});

		if (!response.ok) {
			const errText = await response.text();
			throw error(502, `OpenRouter API error: ${errText}`);
		}

		const apiResp: OpenRouterResponse = await response.json();

		if (apiResp.error) {
			throw error(502, `API error: ${apiResp.error.message}`);
		}

		if (!apiResp.choices || apiResp.choices.length === 0) {
			throw error(502, "No response from API");
		}

		const responseContent = apiResp.choices[0].message.content;
		const jsonStr = extractJSON(responseContent);

		let analysis: IngredientAnalysis;
		try {
			analysis = JSON.parse(jsonStr);
		} catch (e) {
			throw error(502, `Failed to parse analysis result: ${jsonStr}`);
		}

		return json({
			ingredients: analysis.ingredients,
			tokens: apiResp.usage,
		});
	} catch (e) {
		console.error("Analyze error:", e);
		if (e instanceof Error && "status" in e) {
			throw e;
		}
		throw error(500, "Failed to analyze image");
	}
};
