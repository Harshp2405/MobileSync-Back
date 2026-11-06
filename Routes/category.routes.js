import express from "express";
import Category from "../Models/category.js";
import Subcategory from "../Models/subcategory.js";
import { detachCategoryRefs, renameCategoryRefs } from "../Utils/cascade.js";
import { HttpError, findOneCaseInsensitive, requireTrimmedString } from "../Utils/http.js";
import {
  assertRequired,
  buildSyncFilter,
  pickDefined,
  registerSyncRoutes,
  upsertSyncItem,
} from "../Utils/sync.js";

const router = express.Router();

const CATEGORY_FIELDS = ["name", "color"];

// Categories with their subcategories nested (same shape as the mobile web fallback)
router.get("/", async (req, res) => {
  const [categories, subcategories] = await Promise.all([
    Category.find().sort({ createdAt: 1 }).lean(),
    Subcategory.find().sort({ name: 1 }).lean(),
  ]);

  const subsByCategory = new Map();
  for (const sub of subcategories) {
    const list = subsByCategory.get(sub.categoryName) || [];
    list.push(sub);
    subsByCategory.set(sub.categoryName, list);
  }

  res.json(
    categories.map((category) => ({
      ...category,
      subcategories: subsByCategory.get(category.name) || [],
    }))
  );
});

router.post("/", async (req, res) => {
  const name = requireTrimmedString(req.body?.name, "name");
  if (await findOneCaseInsensitive(Category, { name })) {
    throw new HttpError(409, "Category already exists");
  }

  const category = await Category.create({ name, color: req.body.color ?? null });
  res.status(201).json(category);
});

// ==========================================
// 📱 MOBILE SYNC ENDPOINTS
// POST /categories/sync  { categories: [...] }
// GET  /categories/delta?since=<ms>
// ==========================================

registerSyncRoutes(router, {
  Model: Category,
  bodyKey: "categories",
  label: "categories",
  upsertItem: async (item) => {
    assertRequired(item, ["name"]);
    const filter = buildSyncFilter(item, { name: item.name });
    const previous = filter._id ? await Category.findById(filter._id).lean() : null;

    const saved = await upsertSyncItem(Category, filter, pickDefined(item, CATEGORY_FIELDS));
    if (previous && previous.name !== saved.name) {
      await renameCategoryRefs(previous.name, saved.name);
    }
    return saved;
  },
});

// Moves its expenses to "General" and removes its subcategories, like the mobile app.
router.delete("/:id", async (req, res) => {
  const category = await Category.findById(req.params.id).lean();
  if (!category) throw new HttpError(404, "Category not found");

  await detachCategoryRefs(category.name);
  await Category.deleteOne({ _id: category._id });
  res.json({ success: true });
});

export default router;
