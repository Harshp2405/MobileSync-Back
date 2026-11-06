import mongoose from "mongoose";



// Mirrors the mobile SQLite `budgets` table — one budget per month.
const BudgetSchema = new mongoose.Schema(
  {
    month: { type: String, required: true, unique: true },
    amount: { type: Number, required: true },
  },
  { timestamps: true }
);

const Budget = mongoose.model("Budget", BudgetSchema);

export default Budget;
