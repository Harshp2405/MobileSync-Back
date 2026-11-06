import mongoose from "mongoose";

const FuelLogSchema = new mongoose.Schema(
  {
    startKm: { type: Number, required: true },
    odometerKm: { type: Number, default: null },
    litres: { type: Number, required: true },
    pricePerLitre: { type: Number, required: true },
    totalCost: { type: Number, required: true },
    date: { type: String, required: true },
    month: { type: String, required: true },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

const FuelLog = mongoose.model("FuelLog", FuelLogSchema);

export default FuelLog;
