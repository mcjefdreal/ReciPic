import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { pantry } from '$lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

export async function GET() {
	const items = db.select().from(pantry).all();
	console.log(items);
	return json(items);
}


export async function POST({ request }) {
	const body = await request.json();

	const items = body.items;

	if (!Array.isArray(items)) {error(400, 'Expected items array');}

	// Get existing DB pantry items
	const existingItems = db.select().from(pantry).all();

	const existingIds = existingItems.map((item) => item.id);

	// IDs coming from frontend
	const incomingIds = items
		.filter((item) => item.id > 0)
		.map((item) => item.id);

	// Delete removed items
	const idsToDelete = existingIds.filter((id) => !incomingIds.includes(id));

	if (idsToDelete.length > 0) {
		db.delete(pantry)
			.where(inArray(pantry.id, idsToDelete))
			.run();
	}

	// Upsert items
	for (const item of items) {
		if (!item.name?.trim()) continue;

		const cleanItem = {
			name: String(item.name).trim(),
			quantity: Number(item.quantity) || 1,
			unit: item.unit ? String(item.unit) : null,
			category: item.category ? String(item.category) : null
		};

		// Existing DB row
		if (item.id > 0) {
			db.update(pantry)
				.set(cleanItem)
				.where(eq(pantry.id, item.id))
				.run();
		}

		// New row
		else {
			const created = db.insert(pantry)
				.values(cleanItem)
				.run();
			// console.log(created);
		}
	}

	// Return fresh pantry
	const updatedPantry = db.select().from(pantry).all();

	return json(updatedPantry);
}

export async function DELETE({ request }) {
	const body = await request.json().catch(() => ({}));
	if (body.clearAll) {
		db.delete(pantry).run();
		return json({ ok: true, cleared: true });
	}
	if (!body.id) error(400, 'Missing id or clearAll');
	db.delete(pantry).where(eq(pantry.id, body.id)).run();
	return json({ ok: true });
}
