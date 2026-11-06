import express from "express";
import FuelLog from "../Models/fuelLog.js";
import {
  assertRequired,
  buildSyncFilter,
  pickDefined,
  registerSyncRoutes,
  upsertSyncItem,
} from "../Utils/sync.js";

const FUEL_FIELDS = [
  "startKm",
  "odometerKm",
  "litres",
  "pricePerLitre",
  "totalCost",
  "date",
  "month",
  "note",
];

const router = express.Router();

// GET all fuel logs — pending first, then by startKm desc
router.get("/", async (req, res) => {
  try {
    const logs = await FuelLog.find().sort({ odometerKm: 1, createdAt: -1 });
    const pending = logs.filter((l) => l.odometerKm == null);
    const complete = logs.filter((l) => l.odometerKm != null);
    complete.sort((a, b) => b.odometerKm - a.odometerKm);
    res.json([...pending, ...complete]);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch fuel logs" });
  }
});

// POST — add fuel log (odometerKm can be null)
router.post("/", async (req, res) => {
  try {
    const { startKm, odometerKm, litres, pricePerLitre, date, month, note } =
      req.body;
    const totalCost = litres * pricePerLitre;
    const log = await FuelLog.create({
      startKm,
      odometerKm: odometerKm || null,
      litres,
      pricePerLitre,
      totalCost,
      date,
      month,
      note: note || "",
    });
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: "Failed to add fuel log" });
  }
});

// PATCH — update end reading only
router.patch("/:id/end-reading", async (req, res) => {
  try {
    const { odometerKm } = req.body;
    const log = await FuelLog.findByIdAndUpdate(
      req.params.id,
      { odometerKm },
      { new: true },
    );
    if (!log) return res.status(404).json({ error: "Not found" });
    res.json(log);
  } catch (err) {
    res.status(500).json({ error: "Failed to update" });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    await FuelLog.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete" });
  }
});

// GET stats (aggregation)
router.get("/stats", async (req, res) => {
  try {
    const logs = await FuelLog.find({ odometerKm: { $ne: null } });
    let totalKm = 0,
      totalLitres = 0,
      totalCost = 0;
    for (const log of logs) {
      const driven = log.odometerKm - log.startKm;
      if (driven > 0) {
        totalKm += driven;
        totalLitres += log.litres;
        totalCost += log.totalCost;
      }
    }
    if (totalKm === 0 || totalLitres === 0) {
      return res.json(null);
    }
    res.json({
      averageKmPerLitre: totalKm / totalLitres,
      totalKm,
      totalLitres,
      totalCost,
      costPerKm: totalCost / totalKm,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to calculate stats" });
  }
});

// ==========================================
// 📱 MOBILE SYNC ENDPOINTS
// POST /fuel/sync  { fuelLogs: [...] }
// GET  /fuel/delta?since=<ms>
// ==========================================

registerSyncRoutes(router, {
  Model: FuelLog,
  bodyKey: "fuelLogs",
  label: "fuel",
  upsertItem: async (item) => {
    assertRequired(item, ["startKm", "litres", "pricePerLitre", "totalCost", "date", "month"]);
    const filter = buildSyncFilter(item, {
      startKm: item.startKm,
      date: item.date,
      litres: item.litres,
    });
    return upsertSyncItem(FuelLog, filter, pickDefined(item, FUEL_FIELDS));
  },
});

export default router;
