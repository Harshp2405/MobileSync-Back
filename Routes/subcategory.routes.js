import express from "express";
import Category from "../Models/category.js";
import Subcategory from "../Models/subcategory.js";
import { detachSubcategoryRefs, renameSubcategoryRefs } from "../Utils/cascade.js";
import { assertCategoryRef } from "../Utils/references.js";
import {
  HttpError,
  optionalQueryString,
  requireTrimmedString,
} from "../Utils/http.js";
import {
  assertRequired,
  buildSyncFilter,
  registerSyncRoutes,
  upsertSyncItem,
} from "../Utils/sync.js";

const router = express.Router();

const assertUniqueInCategory = async (categoryName, name, excludeId = null) => {
  const siblings = await Subcategory.find({ categoryName }).lean();
  if (siblings.some((sub) =>
    sub.name.toLowerCase() === name.toLowerCase() && String(sub._id) !== String(excludeId)
  )) {
    throw new HttpError(409, "Subcategory already exists");
  }
};

// GET /subcategories?categoryName=Food
router.get("/", async (req, res) => {
  const categoryName = optionalQueryString(req, "categoryName");
  const subcategories = await Subcategory.find(categoryName ? { categoryName } : {}).sort({
    name: 1,
  });
  res.json(subcategories);
});

router.post("/", async (req, res) => {
  const categoryName = requireTrimmedString(req.body?.categoryName, "categoryName");
  const name = requireTrimmedString(req.body?.name, "name");

  if (!(await Category.exists({ name: categoryName }))) {
    throw new HttpError(404, "Category not found");
  }
  await assertUniqueInCategory(categoryName, name);

  const subcategory = await Subcategory.create({ categoryName, name });
  res.status(201).json(subcategory);
});

// ==========================================
// 📱 MOBILE SYNC ENDPOINTS
// POST /subcategories/sync  { subcategories: [...] }
// GET  /subcategories/delta?since=<ms>
// ==========================================

registerSyncRoutes(router, {
  Model: Subcategory,
  bodyKey: "subcategories",
  label: "subcategories",
  upsertItem: async (item) => {
    assertRequired(item, ["categoryName", "name"]);
    const categoryName = requireTrimmedString(item.categoryName, "categoryName");
    const name = requireTrimmedString(item.name, "name");
    await assertCategoryRef(categoryName);
    const filter = buildSyncFilter(item, { categoryName, name });
    const previous = await Subcategory.findOne(filter).lean();
    if (previous && previous.categoryName !== categoryName) {
      throw new HttpError(400, "A subcategory cannot change its parent category");
    }
    await assertUniqueInCategory(categoryName, name, previous?._id);

    const saved = await upsertSyncItem(Subcategory, filter, { categoryName, name });
    if (previous && previous.categoryName === saved.categoryName && previous.name !== saved.name) {
      await renameSubcategoryRefs(saved.categoryName, previous.name, saved.name);
    }
    return saved;
  },
});

// Rename — also updates matching expenses' subcategory string
router.put("/:id", async (req, res) => {
  const name = requireTrimmedString(req.body?.name, "name");
  const existing = await Subcategory.findById(req.params.id).lean();
  if (!existing) throw new HttpError(404, "Subcategory not found");

  await assertUniqueInCategory(existing.categoryName, name, existing._id);

  const updated = await Subcategory.findByIdAndUpdate(
    existing._id,
    { $set: { name } },
    { returnDocument: "after", runValidators: true }
  );
  if (existing.name !== name) {
    await renameSubcategoryRefs(existing.categoryName, existing.name, name);
  }
  res.json(updated);
});

// Delete — matching expenses keep their category but lose the subcategory
router.delete("/:id", async (req, res) => {
  const existing = await Subcategory.findById(req.params.id).lean();
  if (!existing) throw new HttpError(404, "Subcategory not found");

  await detachSubcategoryRefs(existing.categoryName, existing.name);
  await Subcategory.deleteOne({ _id: existing._id });
  res.json({ success: true });
});

export default router;
