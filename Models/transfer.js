import mongoose from "mongoose";

// Mirrors the mobile SQLite `transfers` table, referencing accounts by name.
const TransferSchema = new mongoose.Schema(
  {
    fromAccountName: { type: String, required: true, trim: true },
    toAccountName: { type: String, required: true, trim: true },
    amount: {
      type: Number,
      required: true,
      validate: {
        validator: (value) => value > 0,
        message: "Transfer amount must be greater than zero",
      },
    },
    date: { type: String, default: null },
    month: { type: String, required: true },
    note: { type: String, default: null },
    // Mobile local row id from the first push; makes retried pushes idempotent.
    clientId: { type: Number, default: null },
  },
  { timestamps: true }
);

TransferSchema.pre("validate", function () {
  if (this.fromAccountName && this.fromAccountName === this.toAccountName) {
    this.invalidate("toAccountName", "Source and destination accounts must be different");
  }
});

TransferSchema.index({ updatedAt: 1 });
TransferSchema.index({ clientId: 1 });

const Transfer = mongoose.model("Transfer", TransferSchema);

export default Transfer;
