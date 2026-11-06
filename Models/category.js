import mongoose from "mongoose";

// Mirrors the mobile SQLite `categories` table. Expenses reference categories by `name`.
const CategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    color: { type: String, default: null },
  },
  { timestamps: true }
);

CategorySchema.index({ updatedAt: 1 });

const Category = mongoose.model("Category", CategorySchema);

export default Category;
