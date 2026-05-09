import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const recipes = sqliteTable("recipes", {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    instructions: text("instructions"),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
        () => new Date(),
    ),
});

export const recipeImages = sqliteTable("recipe_images", {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    recipeId: integer("recipe_id")
        .notNull()
        .references(() => recipes.id),
    imageUrl: text("image_url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
        () => new Date(),
    ),
});

export const pantry = sqliteTable("pantry", {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    quantity: real("quantity").notNull().default(1),
    unit: text("unit").default("piece"),
    category: text("category"),
    notes: text("notes"),
    dateAdded: integer("date_added", { mode: "timestamp" }).$defaultFn(
        () => new Date(),
    ),
    dateExpires: integer("date_expires", { mode: "timestamp" }),
    imageUrl: text("image_url"),
    isAvailable: integer("is_available", { mode: "boolean" }).notNull().default(true),
});
