import mongoose from "mongoose";

export const ACCOUNT_TYPES = ["Cash", "Bank", "Card", "UPI", "Wallet"];

// Mirrors the mobile SQLite `accounts` table. `name` is the natural key other collections reference.
const AccountSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true },
    type: { type: String, required: true, enum: ACCOUNT_TYPES, default: "Cash" },
    color: { type: String, default: null },
    initialBalance: { type: Number, required: true, default: 0 },
  },
  { timestamps: true }
);

AccountSchema.index({ updatedAt: 1 });

const Account = mongoose.model("Account", AccountSchema);

export default Account;
