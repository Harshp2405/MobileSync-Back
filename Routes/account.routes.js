import express from "express";
import Account from "../Models/account.js";
import Expense from "../Models/expense.js";
import Income from "../Models/income.js";
import Transfer from "../Models/transfer.js";
import { detachAccountRefs, renameAccountRefs } from "../Utils/cascade.js";
import { HttpError, findOneCaseInsensitive, requireTrimmedString } from "../Utils/http.js";
import {
  assertRequired,
  buildSyncFilter,
  pickDefined,
  registerSyncRoutes,
  upsertSyncItem,
} from "../Utils/sync.js";

const router = express.Router();

const ACCOUNT_FIELDS = ["name", "type", "color", "initialBalance"];

const sumAmountBy = async (Model, field) => {
  const rows = await Model.aggregate([
    { $match: { [field]: { $ne: null } } },
    { $group: { _id: `$${field}`, total: { $sum: "$amount" } } },
  ]);
  return new Map(rows.map((row) => [row._id, row.total]));
};

router.get("/", async (req, res) => {
  const accounts = await Account.find().sort({ name: 1 });
  res.json(accounts);
});

// balance = initialBalance + income - expenses + transfersIn - transfersOut (same as mobile)
router.get("/balances", async (req, res) => {
  const [accounts, spentBy, earnedBy, inBy, outBy] = await Promise.all([
    Account.find().sort({ name: 1 }).lean(),
    sumAmountBy(Expense, "accountName"),
    sumAmountBy(Income, "accountName"),
    sumAmountBy(Transfer, "toAccountName"),
    sumAmountBy(Transfer, "fromAccountName"),
  ]);

  const withBalances = accounts.map((account) => {
    const spent = spentBy.get(account.name) || 0;
    const earned = earnedBy.get(account.name) || 0;
    const transferredIn = inBy.get(account.name) || 0;
    const transferredOut = outBy.get(account.name) || 0;
    const balance =
      Number(account.initialBalance || 0) + earned - spent + transferredIn - transferredOut;
    return { ...account, spent, earned, transferredIn, transferredOut, balance };
  });

  res.json({
    accounts: withBalances,
    combinedBalance: withBalances.reduce((sum, account) => sum + account.balance, 0),
  });
});

router.post("/", async (req, res) => {
  const name = requireTrimmedString(req.body?.name, "name");
  if (await findOneCaseInsensitive(Account, { name })) {
    throw new HttpError(409, "Account already exists");
  }

  const account = await Account.create({
    ...pickDefined(req.body, ACCOUNT_FIELDS),
    name,
    color: req.body.color === undefined ? "#2563EB" : req.body.color,
  });
  res.status(201).json(account);
});

// ==========================================
// 📱 MOBILE SYNC ENDPOINTS
// POST /accounts/sync  { accounts: [...] }
// GET  /accounts/delta?since=<ms>
// ==========================================

registerSyncRoutes(router, {
  Model: Account,
  bodyKey: "accounts",
  label: "accounts",
  upsertItem: async (item) => {
    assertRequired(item, ["name"]);
    const filter = buildSyncFilter(item, { name: item.name });
    const previous = filter._id ? await Account.findById(filter._id).lean() : null;

    const saved = await upsertSyncItem(Account, filter, pickDefined(item, ACCOUNT_FIELDS));
    if (previous && previous.name !== saved.name) {
      await renameAccountRefs(previous.name, saved.name);
    }
    return saved;
  },
});

// Unassigns the account's expenses/income and removes its transfers, like the mobile app.
router.delete("/:id", async (req, res) => {
  const account = await Account.findById(req.params.id).lean();
  if (!account) throw new HttpError(404, "Account not found");

  await detachAccountRefs(account.name);
  await Account.deleteOne({ _id: account._id });
  res.json({ success: true });
});

export default router;
