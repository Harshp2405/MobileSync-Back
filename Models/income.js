import mongoose from "mongoose";

// Mirrors the mobile SQLite `income` table.
const IncomeSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    amount: { type: Number, required: true },
    accountName: { type: String, default: null, trim: true },
    source: { type: String, default: null, trim: true },
    date: { type: String, default: null },
    description: { type: String, default: null },
    month: { type: String, required: true },
    method: { type: String, default: null },
    // Mobile local row id from the first push; makes retried pushes idempotent.
    clientId: { type: Number, default: null },
  },
  { timestamps: true }
);

IncomeSchema.index({ month: 1, createdAt: -1 });
IncomeSchema.index({ updatedAt: 1 });
IncomeSchema.index({ clientId: 1 });

const Income = mongoose.model("Income", IncomeSchema);

export default Income;
