import { json } from '@sveltejs/kit';
import { db } from '$lib/db';
import { pantry, recipes } from '$lib/db/schema';

export async function GET() {
	const items = db.select().from(pantry).all();
	if (!items.length) {
		return json({ recipes: [], pantry: [] });
	}

	const names = items.map((i) => i.name.toLowerCase().trim()).filter(Boolean);
	if (!names.length) {
		return json({ recipes: [], pantry: items });
	}

	// Fetch all recipes and score by pantry ingredient overlap.
	// When the CSV dataset is loaded, this same logic works against the populated table.
	const allRecipes = db.select().from(recipes).all();

	const scored = allRecipes
		.map((r) => {
			const recipeIngs = (r.ingredients ?? r.name ?? '').toLowerCase();
			const matches = names.filter((n) => recipeIngs.includes(n));
			return {
				id: r.id,
				name: r.name,
				description: r.description,
				ingredients: r.ingredients,
				instructions: r.instructions,
				createdAt: r.createdAt,
				matchCount: matches.length,
				matches
			};
		})
		.filter((r) => r.matchCount > 0);

	scored.sort((a, b) => b.matchCount - a.matchCount);

	return json({ recipes: scored, pantry: items });
}
