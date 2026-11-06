import mongoose from "mongoose";
import { HttpError } from "./http.js";

// Shared helpers for the mobile offline-first sync protocol:
//   POST /<entity>/sync  { <bodyKey>: [{ id, remoteId, ...fields }] } -> { success, syncedIds, failed }
//   GET  /<entity>/delta?since=<ms>                                   -> { items, timestamp, activeIds }

const UPSERT_OPTIONS = {
  upsert: true,
  returnDocument: "after",
  runValidators: true,
  setDefaultsOnInsert: true,
  sanitizeFilter: true,
};

export const pickDefined = (source, fields) => {
  const result = {};
  if (!source || typeof source !== "object") return result;
  for (const field of fields) {
    if (source[field] !== undefined) result[field] = source[field];
  }
  return result;
};

export class SyncItemError extends Error {}

export const assertRequired = (item, fields) => {
  const missing = fields.filter(
    (field) => item[field] === undefined || item[field] === null || item[field] === ""
  );
  if (missing.length > 0) {
    throw new SyncItemError(`Missing required field(s): ${missing.join(", ")}`);
  }
};

const normalizeRemoteId = (remoteId) => {
  if (remoteId === undefined || remoteId === null || remoteId === "") return null;
  if (typeof remoteId !== "string" || !mongoose.isValidObjectId(remoteId)) {
    throw new SyncItemError("Invalid remoteId");
  }
  return remoteId;
};

// Matches by remoteId when the item was synced before, otherwise by the entity's natural key.
export const buildSyncFilter = (item, naturalKey) => {
  const remoteId = normalizeRemoteId(item.remoteId);
  return remoteId ? { _id: remoteId } : naturalKey;
};

export const upsertSyncItem = (Model, filter, update) =>
  Model.findOneAndUpdate(filter, { $set: update }, UPSERT_OPTIONS);

// Runs sequentially so items that depend on earlier ones in the batch see their writes.
export const runSyncBatch = async (items, label, upsertItem) => {
  const syncedIds = [];
  const failed = [];

  for (const item of items) {
    const localId = item?.id ?? null;
    try {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new SyncItemError("Sync item must be an object");
      }
      if (typeof item.id !== "number" || !Number.isFinite(item.id) || item.id <= 0) {
        throw new SyncItemError("Local 'id' must be a positive number");
      }
      const savedDoc = await upsertItem(item);
      syncedIds.push({ localId, remoteId: savedDoc._id });
    } catch (error) {
      console.error(`[Sync] Error syncing ${label} item (localId: ${localId}):`, error);
      failed.push({ localId, error: describeSyncError(error) });
    }
  }

  return { syncedIds, failed };
};

const describeSyncError = (error) => {
  if (error instanceof SyncItemError || error instanceof HttpError) return error.message;
  if (error?.name === "ValidationError" || error?.name === "CastError") return error.message;
  if (error?.code === 11000) return "Duplicate record";
  return "Failed to sync item";
};

export const parseSince = (raw) => {
  if (raw === undefined || raw === "") return new Date(0);
  if (typeof raw !== "string") return null;
  const ms = Number(raw);
  if (!Number.isSafeInteger(ms) || ms < 0 || ms > 8640000000000000) return null;
  return new Date(ms);
};

export const registerSyncRoutes = (router, { Model, bodyKey, label, upsertItem }) => {
  router.post("/sync", async (req, res) => {
    const items = req.body?.[bodyKey];
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: `Request body must include a '${bodyKey}' array` });
    }

    console.log(`[Sync] Received POST /${label}/sync with ${items.length} items`);
    const { syncedIds, failed } = await runSyncBatch(items, label, upsertItem);
    res.json({ success: failed.length === 0, syncedIds, failed });
  });

  router.get("/delta", async (req, res) => {
    const since = parseSince(req.query.since);
    if (!since) {
      return res.status(400).json({ error: "Query param 'since' must be a non-negative epoch-ms number" });
    }

    console.log(`[Sync] Received GET /${label}/delta since ${since.toISOString()}`);
    // Captured before querying so writes racing with this request are re-sent on the next pull.
    const timestamp = Date.now();

    const [items, activeDocs] = await Promise.all([
      Model.find({ updatedAt: { $gte: since } }).select("-__v").lean(),
      Model.find({}).select("_id").lean(),
    ]);

    res.json({ items, timestamp, activeIds: activeDocs.map((doc) => String(doc._id)) });
  });
};
