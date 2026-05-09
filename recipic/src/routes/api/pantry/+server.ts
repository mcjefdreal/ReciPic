import { json, error } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { db } from "$lib/db";
import { pantry } from "$lib/db/schema";
import { eq, desc } from "drizzle-orm";

export const GET: RequestHandler = async () => {
	try {
		const items = await db.query.pantry.findMany({
			orderBy: [desc(pantry.dateAdded)],
		});
		return json({ items });
	} catch (e) {
		console.error("Failed to fetch pantry items:", e);
		throw error(500, "Failed to fetch pantry items");
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();
		const { items } = body as {
			items: Array<{
				name: string;
				quantity: number;
				unit?: string;
				category?: string;
			}>;
		};

		if (!items || !Array.isArray(items) || items.length === 0) {
			throw error(400, "No items provided");
		}

		const inserted = await db
			.insert(pantry)
			.values(
				items.map((item) => ({
					name: item.name,
					quantity: item.quantity,
					unit: item.unit ?? "piece",
					category: item.category ?? null,
				})),
			)
			.returning();

		return json({ success: true, items: inserted });
	} catch (e) {
		console.error("Failed to save pantry items:", e);
		if (e instanceof Error && "status" in e) {
			throw e;
		}
		throw error(500, "Failed to save pantry items");
	}
};
