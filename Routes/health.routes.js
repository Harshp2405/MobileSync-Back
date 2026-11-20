import express from "express";
import mongoose from "mongoose";

const router = express.Router();
const DATABASE_STATES = ["disconnected", "connected", "connecting", "disconnecting"];

// Liveness probe for Render and external uptime monitors. It never queries the database, so a
// frequent ping stays cheap and a brief database reconnect does not restart the service.
router.get("/", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    status: "ok",
    uptime: Math.round(process.uptime()),
    database: DATABASE_STATES[mongoose.connection.readyState] ?? "unknown",
  });
});

export default router;
