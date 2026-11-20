import express from "express";
import cors from "cors";
import budgetRoutes from "./Routes/budget.routes.js";
import expenseRoutes from "./Routes/expense.routes.js";
import fuelRoutes from "./Routes/fuel.routes.js";
import incomeRoutes from "./Routes/income.routes.js";
import accountRoutes from "./Routes/account.routes.js";
import transferRoutes from "./Routes/transfer.routes.js";
import categoryRoutes from "./Routes/category.routes.js";
import subcategoryRoutes from "./Routes/subcategory.routes.js";
import healthRoutes from "./Routes/health.routes.js";
import { errorHandler } from "./Utils/http.js";

const app = express();
app.use(cors());
app.use("/health", healthRoutes);
app.use(express.json({ limit: "5mb" }));

app.use("/budget", budgetRoutes);
app.use("/expenses", expenseRoutes);
app.use("/fuel", fuelRoutes);
app.use("/income", incomeRoutes);
app.use("/accounts", accountRoutes);
app.use("/transfers", transferRoutes);
app.use("/categories", categoryRoutes);
app.use("/subcategories", subcategoryRoutes);
app.use(errorHandler);

export default app;
