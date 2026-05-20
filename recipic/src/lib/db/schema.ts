import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const recipes = sqliteTable("recipes", {
    id: integer("id", { mode: "number" }).primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    description: text("description"),
    ingredients: text("ingredients"),
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
    quantity: integer("quantity").notNull().default(1),
    unit: text("unit"),
    addedAt: integer("added_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
