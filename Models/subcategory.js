import mongoose from "mongoose";

// Mirrors the mobile SQLite `subcategories` table; parent category is referenced by name.
const SubcategorySchema = new mongoose.Schema(
  {
    categoryName: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true }
);

SubcategorySchema.index({ categoryName: 1, name: 1 }, { unique: true });
SubcategorySchema.index({ updatedAt: 1 });

const Subcategory = mongoose.model("Subcategory", SubcategorySchema);

export default Subcategory;
