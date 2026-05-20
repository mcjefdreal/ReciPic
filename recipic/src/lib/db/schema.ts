import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const recipes = sqliteTable("recipes", {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    ingredients: text("ingredients"),
    instructions: text("instructions"),
    link: text("link"),
    source: text("source"),
    site: text("site"),
    ner: text("ner"),
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
    quantity: integer("quantity").notNull().default(1),
    unit: text("unit"),
    category: text("category"),
    notes: text("notes"),
    dateAdded: integer("date_added", { mode: "timestamp" }),
    dateExpires: integer("date_expires", { mode: "timestamp" }),
    imageUrl: text("image_url"),
    isAvailable: integer("is_available", { mode: "boolean" }).default(true),
});
