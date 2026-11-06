import express from "express";
import Transfer from "../Models/transfer.js";
import { HttpError, optionalQueryString } from "../Utils/http.js";
import { assertAccountRefs } from "../Utils/references.js";
import {
  SyncItemError,
  assertRequired,
  buildSyncFilter,
  pickDefined,
  registerSyncRoutes,
  upsertSyncItem,
} from "../Utils/sync.js";

const router = express.Router();

// Mirrors the mobile `transfers` columns (from/toAccountId -> from/toAccountName).
const TRANSFER_FIELDS = ["fromAccountName", "toAccountName", "amount", "date", "month", "note"];

router.get("/", async (req, res) => {
  const month = optionalQueryString(req, "month");
  const transfers = await Transfer.find(month ? { month } : {}).sort({ createdAt: -1 });
  res.json(transfers);
});

router.post("/", async (req, res) => {
  const fields = pickDefined(req.body, TRANSFER_FIELDS);
  await assertAccountRefs(fields);
  const transfer = await Transfer.create(fields);
  res.status(201).json(transfer);
});

// ==========================================
// 📱 MOBILE SYNC ENDPOINTS
// POST /transfers/sync  { transfers: [...] }
// GET  /transfers/delta?since=<ms>
// ==========================================

registerSyncRoutes(router, {
  Model: Transfer,
  bodyKey: "transfers",
  label: "transfers",
  upsertItem: async (item) => {
    assertRequired(item, ["fromAccountName", "toAccountName", "amount", "month"]);
    const fields = pickDefined(item, TRANSFER_FIELDS);
    await assertAccountRefs(fields);
    // Document-level validate hooks don't run on upserts, so enforce this rule here.
    if (String(item.fromAccountName).trim() === String(item.toAccountName).trim()) {
      throw new SyncItemError("Source and destination accounts must be different");
    }

    const filter = buildSyncFilter(item, {
      clientId: item.id,
      fromAccountName: item.fromAccountName,
      toAccountName: item.toAccountName,
      amount: item.amount,
      month: item.month,
    });
    return upsertSyncItem(Transfer, filter, fields);
  },
});

router.delete("/:id", async (req, res) => {
  const deleted = await Transfer.findByIdAndDelete(req.params.id);
  if (!deleted) throw new HttpError(404, "Transfer not found");
  res.json({ success: true });
});

export default router;
