import { json, error } from '@sveltejs/kit';
import { db } from '$lib/db';
import { pantry } from '$lib/db/schema';
import { eq, sql } from 'drizzle-orm';

export async function GET() {
	const items = db.select().from(pantry).all();
	return json(items);
}

export async function POST({ request }) {
	const body = await request.json();
	const items = body.items;
	if (!Array.isArray(items)) error(400, 'Expected items array');

	const inserted: typeof pantry.$inferSelect[] = [];
	for (const item of items) {
		if (!item.name) continue;
		const name = String(item.name).trim().toLowerCase();
		const quantity = Number(item.quantity) || 1;
		const unit = item.unit ? String(item.unit) : null;

		// Upsert: if same name exists, update quantity; otherwise insert.
		const existing = db
			.select()
			.from(pantry)
			.where(sql`lower(${pantry.name}) = ${name}`)
			.get();

		if (existing) {
			const updated = db
				.update(pantry)
				.set({ quantity: existing.quantity + quantity, unit: unit ?? existing.unit })
				.where(eq(pantry.id, existing.id))
				.returning()
				.get();
			inserted.push(updated);
		} else {
			const created = db
				.insert(pantry)
				.values({ name: String(item.name).trim(), quantity, unit })
				.returning()
				.get();
			inserted.push(created);
		}
	}
	return json(inserted, { status: 201 });
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
