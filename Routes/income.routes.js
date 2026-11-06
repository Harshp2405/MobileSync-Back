import express from "express";
import Income from "../Models/income.js";
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

// Mirrors the mobile `income` columns (accountId -> accountName).
const INCOME_FIELDS = [
  "title",
  "amount",
  "accountName",
  "source",
  "date",
  "description",
  "month",
  "method",
];

// GET /income?month=yyyy-MM&accountName=... — newest first; all income when no month is given
router.get("/", async (req, res) => {
  const month = optionalQueryString(req, "month");
  const accountName = optionalQueryString(req, "accountName");

  const filter = {};
  if (month) filter.month = month;
  if (accountName) filter.accountName = accountName;

  const income = await Income.find(filter).sort({ createdAt: -1 });
  res.json(income);
});

router.post("/", async (req, res) => {
  const fields = pickDefined(req.body, INCOME_FIELDS);
  await assertAccountRefs(fields);
  const income = await Income.create(fields);
  res.status(201).json(income);
});

// ==========================================
// 📱 MOBILE SYNC ENDPOINTS
// POST /income/sync  { income: [...] }
// GET  /income/delta?since=<ms>
// ==========================================

registerSyncRoutes(router, {
  Model: Income,
  bodyKey: "income",
  label: "income",
  upsertItem: async (item) => {
    assertRequired(item, ["title", "amount", "month"]);
    const fields = pickDefined(item, INCOME_FIELDS);
    await assertAccountRefs(fields);
    const filter = buildSyncFilter(item, {
      clientId: item.id,
      title: item.title,
      month: item.month,
      amount: item.amount,
    });
    return upsertSyncItem(Income, filter, fields);
  },
});

router.put("/:id", async (req, res) => {
  const fields = pickDefined(req.body, INCOME_FIELDS);
  await assertAccountRefs(fields);
  const income = await Income.findByIdAndUpdate(
    req.params.id,
    { $set: fields },
    { returnDocument: "after", runValidators: true }
  );
  if (!income) throw new HttpError(404, "Income not found");
  res.json(income);
});

router.delete("/:id", async (req, res) => {
  const deleted = await Income.findByIdAndDelete(req.params.id);
  if (!deleted) throw new HttpError(404, "Income not found");
  res.json({ success: true });
});

export default router;
