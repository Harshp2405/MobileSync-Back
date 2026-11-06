import express from "express";
import Budget from "../Models/budget.js";
import { HttpError, optionalQueryString, requireTrimmedString } from "../Utils/http.js";
import { assertRequired, pickDefined, runSyncBatch, upsertSyncItem } from "../Utils/sync.js";

const router = express.Router();

// Get budget by month
router.get("/", async (req, res) => {
  const month = optionalQueryString(req, "month");
  const budget = await Budget.findOne({ month });
  res.json(budget || {});
});

// Save / update budget
router.post("/", async (req, res) => {
  const month = requireTrimmedString(req.body?.month, "month");
  const amount = req.body.amount;
  if (amount === undefined || amount === null) {
    throw new HttpError(400, "'amount' is required");
  }
  const budget = await upsertSyncItem(Budget, { month }, { month, amount });

  res.json(budget);
});

// ==========================================
// 📱 MOBILE SYNC ENDPOINTS
// ==========================================

// POST /budget/sync — Push pending mobile budgets to MongoDB
router.post("/sync", async (req, res) => {
  const { budgets } = req.body ?? {};
  if (!Array.isArray(budgets)) {
    return res.status(400).json({ error: "Request body must include a 'budgets' array" });
  }
  console.log(`[Sync] Received POST /budget/sync with ${budgets.length} items`);

  // Month is unique, so it is always the match key (avoids duplicate-key failures when a
  // stale remoteId points at a deleted doc while another doc already owns that month).
  const { syncedIds, failed } = await runSyncBatch(budgets, "budget", (item) => {
    assertRequired(item, ["month", "amount"]);
    return upsertSyncItem(Budget, { month: item.month }, pickDefined(item, ["month", "amount"]));
  });

  res.json({ success: failed.length === 0, syncedIds, failed });
});

// GET /budget/delta — Full pull: the mobile reconciles deletions by comparing months
router.get("/delta", async (req, res) => {
  console.log("[Sync] Received GET /budget/delta");
  const currentTimestamp = Date.now();
  const items = await Budget.find({}).select("-__v").lean();
  res.json({
    items,
    timestamp: currentTimestamp,
    activeIds: items.map((doc) => String(doc._id)),
  });
});

export default router;
