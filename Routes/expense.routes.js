import express from "express";
import Expense from "../Models/expense.js";
import { HttpError, optionalQueryString } from "../Utils/http.js";
import { assertAccountRefs } from "../Utils/references.js";
import {
  assertRequired,
  buildSyncFilter,
  pickDefined,
  registerSyncRoutes,
  upsertSyncItem,
} from "../Utils/sync.js";

const router = express.Router();

// Mirrors the mobile `expenses` columns (accountId -> accountName).
const EXPENSE_FIELDS = [
  "title",
  "amount",
  "category",
  "subcategory",
  "accountName",
  "date",
  "description",
  "month",
  "method",
  "imageUri",
];

// Get expenses by month (optionally filtered by account)
router.get("/", async (req, res) => {
  const month = optionalQueryString(req, "month");
  const accountName = optionalQueryString(req, "accountName");

  const filter = {};
  if (month) filter.month = month;
  if (accountName) filter.accountName = accountName;

  const expenses = await Expense.find(filter).sort({ createdAt: -1 });
  res.json(expenses);
});

// Add expense
router.post("/", async (req, res) => {
  const fields = pickDefined(req.body, EXPENSE_FIELDS);
  await assertAccountRefs(fields);
  const expense = await Expense.create(fields);
  res.json(expense);
});

// Monthly history (AGGREGATION)
router.get("/history", async (req, res) => {
  const history = await Expense.aggregate([
    {
      $group: {
        _id: "$month",
        total: { $sum: "$amount" },
      },
    },
    {
      $project: {
        _id: 0,
        month: "$_id",
        total: 1,
      },
    },
    { $sort: { month: 1 } },
  ]);

  res.json(history);
});

// ==========================================
// 📱 MOBILE SYNC ENDPOINTS
// POST /expenses/sync  { expenses: [...] }
// GET  /expenses/delta?since=<ms>
// ==========================================

registerSyncRoutes(router, {
  Model: Expense,
  bodyKey: "expenses",
  label: "expenses",
  upsertItem: async (item) => {
    assertRequired(item, ["title", "amount", "month"]);
    const fields = pickDefined(item, EXPENSE_FIELDS);
    await assertAccountRefs(fields);
    const filter = buildSyncFilter(item, {
      clientId: item.id,
      title: item.title,
      month: item.month,
      amount: item.amount,
    });
    return upsertSyncItem(Expense, filter, fields);
  },
});

// Update expense (only provided fields are changed)
router.put("/:id", async (req, res) => {
  const fields = pickDefined(req.body, EXPENSE_FIELDS);
  await assertAccountRefs(fields);
  const expense = await Expense.findByIdAndUpdate(
    req.params.id,
    { $set: fields },
    { returnDocument: "after", runValidators: true }
  );
  if (!expense) throw new HttpError(404, "Expense not found");
  res.json(expense);
});

// DELETE expense
router.delete("/:id", async (req, res) => {
  await Expense.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

export default router;
