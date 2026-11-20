import mongoose from "mongoose";
import "dotenv/config";
import app from "./App.js";

const dburl = process.env.MONGODB_URI;
const PORT = process.env.PORT || 5000;

try {
  if (!dburl) throw new Error("MONGODB_URI is required");
  await mongoose.connect(dburl);
  console.log("MongoDB Connected");
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
} catch (error) {
  console.error("MongoDB Connection Error:", error);
  process.exitCode = 1;
}
