import Expense from "../Models/expense.js";
import Income from "../Models/income.js";
import Budget from "../Models/budget.js";
import FuelLog from "../Models/fuelLog.js";
import Account from "../Models/account.js";
import Transfer from "../Models/transfer.js";
import Category from "../Models/category.js";
import Subcategory from "../Models/subcategory.js";
import expenseRoutes from "../Routes/expense.routes.js";
import incomeRoutes from "../Routes/income.routes.js";
import budgetRoutes from "../Routes/budget.routes.js";
import fuelRoutes from "../Routes/fuel.routes.js";
import accountRoutes from "../Routes/account.routes.js";
import transferRoutes from "../Routes/transfer.routes.js";
import categoryRoutes from "../Routes/category.routes.js";
import subcategoryRoutes from "../Routes/subcategory.routes.js";

export const entities = [
  {
    table: "expenses", Model: Expense, router: expenseRoutes,
    path: "/expenses", bodyKey: "expenses",
    data: {
      title: "Lunch", amount: 125.5, category: "Food", subcategory: "Meals",
      accountName: "Cash", date: "03/11/2026", description: "Team lunch",
      month: "2026-11", method: "UPI", imageUri: "file:///receipts/lunch.jpg",
    },
  },
  {
    table: "income", Model: Income, router: incomeRoutes,
    path: "/income", bodyKey: "income",
    data: {
      title: "Salary", amount: 2000, accountName: "Bank", source: "Salary",
      date: "03/11/2026", description: "Monthly pay", month: "2026-11", method: null,
    },
  },
  {
    table: "budgets", Model: Budget, router: budgetRoutes,
    path: "/budget", bodyKey: "budgets",
    data: { month: "2026-11", amount: 5000 },
  },
  {
    table: "fuel_logs", Model: FuelLog, router: fuelRoutes,
    path: "/fuel", bodyKey: "fuelLogs",
    data: {
      startKm: 1200, odometerKm: null, litres: 5, pricePerLitre: 100,
      totalCost: 500, date: "03/11/2026", month: "2026-11", note: null,
    },
  },
  {
    table: "accounts", Model: Account, router: accountRoutes,
    path: "/accounts", bodyKey: "accounts",
    data: { name: "Cash", type: "Cash", color: "#2563EB", initialBalance: 1000 },
  },
  {
    table: "transfers", Model: Transfer, router: transferRoutes,
    path: "/transfers", bodyKey: "transfers",
    data: {
      fromAccountName: "Bank", toAccountName: "Cash", amount: 100,
      date: "03/11/2026", month: "2026-11", note: "ATM",
    },
  },
  {
    table: "categories", Model: Category, router: categoryRoutes,
    path: "/categories", bodyKey: "categories",
    data: { name: "Food", color: "#EF4444" },
  },
  {
    table: "subcategories", Model: Subcategory, router: subcategoryRoutes,
    path: "/subcategories", bodyKey: "subcategories",
    data: { categoryName: "Food", name: "Meals" },
  },
];

export const entity = (table) => entities.find((item) => item.table === table);
