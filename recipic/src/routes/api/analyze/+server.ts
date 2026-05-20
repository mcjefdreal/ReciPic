import { json, error } from '@sveltejs/kit';
import { OPENROUTER_API_KEY } from '$env/static/private';

const OpenRouterAPIURL = 'https://openrouter.ai/api/v1/chat/completions';
const Model = 'qwen/qwen3.6-flash';

function extractJSON(content: string): string {
    const start = content.indexOf('```json');
    if (start !== -1) {
        const block = content.slice(start + 7);
        const end = block.indexOf('```');
        if (end !== -1) return block.slice(0, end).trim();
    }
    const plain = content.indexOf('```');
    if (plain !== -1) {
        const block = content.slice(plain + 3);
        const end = block.indexOf('```');
        if (end !== -1) return block.slice(0, end).trim();
    }
    return content.trim();
}

export async function POST({ request }) {
    const form = await request.formData();
    const file = form.get('image') as File;
    if (!file) error(400, 'No image');

    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const dataURL = `data:${file.type};base64,${base64}`;

    const prompt = `List ingredients in this image. Use GENERAL names only (tomato, not roma tomato).

STRICT RULES:
- Max 10 ingredients
- JSON ONLY, no explanation
- 1 word names only

OUTPUT:
{"ingredients":[{"name":"tomato","count":3},{"name":"onion","count":1}]}`;

    const reqBody = {
        model: Model,
        messages: [
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: dataURL } }
                ]
            }
        ],
        temperature: 0,
        max_tokens: 256,
        provider: { order: ['Novita', 'DeepInfra', 'Fireworks', 'Hyperbolic'] }
    };

    const resp = await fetch(OpenRouterAPIURL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://recipic.app',
            'X-Title': 'ReciPic'
        },
        body: JSON.stringify(reqBody)
    });

    const apiResp = await resp.json().catch(() => ({}));
    if (apiResp.error) error(502, apiResp.error.message || 'API error');
    if (!apiResp.choices?.length) error(502, 'No response from API');

    const content = apiResp.choices[0].message.content;
    const jsonStr = extractJSON(content);

    let analysis;
    try {
        analysis = JSON.parse(jsonStr);
    } catch {
        error(502, `Invalid JSON: ${jsonStr}`);
    }

    return json({ ingredients: analysis.ingredients || [] });
}
