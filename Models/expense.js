import mongoose from "mongoose";

// Mirrors the mobile SQLite `expenses` table (src/lib/db/schema.js).
// `accountName` replaces the mobile's local integer `accountId` so links survive across devices.
const ExpenseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    amount: { type: Number, required: true },
    category: { type: String, default: null, trim: true },
    subcategory: { type: String, default: null, trim: true },
    accountName: { type: String, default: null, trim: true },
    date: { type: String, default: null },
    description: { type: String, default: null },
    month: { type: String, required: true },
    method: { type: String, default: null },
    imageUri: { type: String, default: null },
    // Local row id distinguishes identical entries on one client; it is not a cross-device identity.
    clientId: { type: Number, default: null },
  },
  { timestamps: true }
);

ExpenseSchema.index({ month: 1, createdAt: -1 });
ExpenseSchema.index({ updatedAt: 1 });
ExpenseSchema.index({ clientId: 1 });

const Expense = mongoose.model("Expense", ExpenseSchema);

export default Expense;
