import assert from "node:assert/strict";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import mongoose from "mongoose";
import app from "../App.js";
import { entities, entity } from "./fixtures.js";

// Never load .env or use Railway_Mongo_Uri. Only this randomly named local test database is removed.
const uri = process.env.TEST_MONGO_URI || "mongodb://127.0.0.1:27017";
const dbName = `expense_backend_test_${randomUUID().replaceAll("-", "")}`;
let server;
let baseUrl;

before(async () => {
  const parsed = new URL(uri);
  assert.equal(parsed.protocol, "mongodb:", "Integration tests require a local MongoDB");
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname), "Only loopback MongoDB is allowed");
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  await Promise.all(entities.map(({ Model }) => Model.init()));
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  try {
    if (mongoose.connection.readyState === 1 && mongoose.connection.name === dbName) {
      await mongoose.connection.dropDatabase();
    }
  } finally {
    if (server) await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.disconnect();
  }
});

beforeEach(async () => {
  await Promise.all(entities.map(({ Model }) => Model.deleteMany({})));
  await entity("accounts").Model.create([
    entity("accounts").data,
    { name: "Bank", type: "Bank", initialBalance: 500 },
  ]);
  await entity("categories").Model.create(entity("categories").data);
  await entity("subcategories").Model.create(entity("subcategories").data);
});

const request = async (method, route, body, expectedStatus = 200) => {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  assert.equal(response.status, expectedStatus, JSON.stringify(result));
  return result;
};

const push = (item, rows) => request("POST", `${item.path}/sync`, { [item.bodyKey]: rows });
const assertSynced = (result, count = 1) => {
  assert.equal(result.success, true, JSON.stringify(result));
  assert.deepEqual(result.failed, []);
  assert.equal(result.syncedIds.length, count);
};

for (const item of entities) {
  test(`MongoDB ${item.table}: all mobile fields survive push, retry, and delta pull`, async () => {
    const row = { id: 7, ...item.data };
    const saved = await push(item, [row]);
    assertSynced(saved);
    const remoteId = saved.syncedIds[0].remoteId;
    const retry = await push(item, [row]);
    assertSynced(retry);
    assert.equal(retry.syncedIds[0].remoteId, remoteId);
    assert.equal(await item.Model.countDocuments({ _id: remoteId }), 1);

    const delta = await request("GET", `${item.path}/delta?since=0`);
    assert.equal(typeof delta.timestamp, "number");
    assert.ok(delta.activeIds.includes(remoteId));
    const pulled = delta.items.find(({ _id }) => _id === remoteId);
    assert.ok(pulled.createdAt);
    assert.ok(pulled.updatedAt);
    for (const [field, value] of Object.entries(item.data)) assert.equal(pulled[field], value);
  });
}

test("MongoDB legacy web expense, budget, fuel APIs retain their response shapes", async () => {
  const expense = await request("POST", "/expenses", {
    title: "Tea", amount: 10, month: "2026-11", method: "Cash",
  });
  assert.ok(expense._id);
  const list = await request("GET", "/expenses?month=2026-11");
  assert.equal(list[0]._id, expense._id);
  assert.equal((await request("GET", "/expenses"))[0]._id, expense._id);
  assert.deepEqual(await request("GET", "/expenses/history"), [{ total: 10, month: "2026-11" }]);
  assert.deepEqual(await request("GET", "/budget?month=2026-11"), {});
  await request("POST", "/budget", { month: "2026-11", amount: 200 });
  const budget = await request("POST", "/budget", { month: "2026-11", amount: 300 });
  assert.equal((await request("GET", "/budget?month=2026-11")).amount, 300);
  assert.equal(await entity("budgets").Model.countDocuments(), 1);
  assert.equal((await request("GET", "/budget/delta?since=9999999999999")).items[0]._id, budget._id);

  const fuel = await request("POST", "/fuel", {
    startKm: 100, litres: 2, pricePerLitre: 100, date: "03/11/2026", month: "2026-11",
  });
  assert.equal(fuel.totalCost, 200);
  assert.equal(fuel.odometerKm, null);
  assert.equal(await request("GET", "/fuel/stats"), null);
  await request("PATCH", `/fuel/${fuel._id}/end-reading`, { odometerKm: 200 });
  assert.equal((await request("GET", "/fuel"))[0].odometerKm, 200);
  assert.deepEqual(await request("GET", "/fuel/stats"), {
    averageKmPerLitre: 50, totalKm: 100, totalLitres: 2, totalCost: 200, costPerKm: 2,
  });
  assert.deepEqual(await request("DELETE", `/expenses/${expense._id}`), { success: true });
  assert.deepEqual(await request("DELETE", `/fuel/${fuel._id}`), { success: true });
  assert.deepEqual((await request("GET", "/expenses/delta")).activeIds, []);
});

test("MongoDB sync preserves nullable fields, zero values, and omitted fields from old clients", async () => {
  const expenses = entity("expenses");
  const created = await push(expenses, [{ id: 1, ...expenses.data }]);
  assertSynced(created);
  const remoteId = created.syncedIds[0].remoteId;
  assertSynced(await push(expenses, [{
    id: 1, remoteId, title: "Changed", amount: 0, month: "2026-11", method: null,
  }]));
  let stored = await expenses.Model.findById(remoteId).lean();
  for (const field of ["category", "subcategory", "accountName", "date", "description", "imageUri"]) {
    assert.equal(stored[field], expenses.data[field]);
  }
  assert.equal(stored.amount, 0);
  assert.equal(stored.method, null);
  await request("PUT", `/expenses/${remoteId}`, { accountName: null, imageUri: null });
  stored = await expenses.Model.findById(remoteId).lean();
  assert.equal(stored.accountName, null);
  assert.equal(stored.imageUri, null);
  assert.equal(stored.title, "Changed");

  const fuel = entity("fuel_logs");
  const initialFuel = await push(fuel, [{ id: 1, ...fuel.data, odometerKm: 1500, note: "Keep" }]);
  assertSynced(initialFuel);
  const fuelId = initialFuel.syncedIds[0].remoteId;
  const { odometerKm, note, ...requiredFuelFields } = fuel.data;
  assertSynced(await push(fuel, [{ id: 1, remoteId: fuelId, ...requiredFuelFields }]));
  const storedFuel = await fuel.Model.findById(fuelId).lean();
  assert.equal(storedFuel.odometerKm, 1500);
  assert.equal(storedFuel.note, "Keep");
});

test("MongoDB identical transaction rows are distinct and remoteId updates do not duplicate them", async () => {
  for (const table of ["expenses", "income", "transfers"]) {
    const item = entity(table);
    const saved = await push(item, [{ id: 1, ...item.data }, { id: 2, ...item.data }]);
    assertSynced(saved, 2);
    assert.notEqual(saved.syncedIds[0].remoteId, saved.syncedIds[1].remoteId);
    assertSynced(await push(item, [{ id: 1, remoteId: saved.syncedIds[0].remoteId, ...item.data, amount: 50 }]));
    assert.equal(await item.Model.countDocuments(), 2);
    assert.equal((await item.Model.findById(saved.syncedIds[0].remoteId)).amount, 50);
  }
});

test("MongoDB references and invalid rows fail explicitly without preventing valid rows", async () => {
  for (const table of ["expenses", "income", "transfers", "subcategories"]) {
    const item = entity(table);
    const field = table === "subcategories" ? "categoryName" : table === "transfers" ? "toAccountName" : "accountName";
    const result = await push(item, [
      { id: 1, ...item.data, [field]: "Missing" },
      { id: 2, ...item.data },
    ]);
    assert.equal(result.success, false);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].localId, 1);
    assert.equal(result.syncedIds.length, 1);
    assert.equal(result.syncedIds[0].localId, 2);
  }
  for (const body of [{}, { month: "2026-11" }, { amount: 10 }]) {
    await request("POST", "/budget", body, 400);
  }
  await request("POST", "/accounts", { name: "Invalid balance", initialBalance: "invalid" }, 400);
  await request("POST", "/transfers", { ...entity("transfers").data, fromAccountName: "Cash" }, 400);
  await request("POST", "/transfers", { ...entity("transfers").data, amount: 0 }, 400);
  await request("POST", "/subcategories", { categoryName: "Food", name: "meals" }, 409);
  await request("GET", "/expenses/delta?since=1e30", undefined, 400);
  await request("DELETE", "/expenses/not-an-id", undefined, 400);
  const unsafe = await push(entity("expenses"), [
    { id: 1, ...entity("expenses").data, title: { $ne: null } },
  ]);
  assert.equal(unsafe.success, false);
  assert.equal(unsafe.syncedIds.length, 0);
});

test("MongoDB delta includes timestamp-boundary updates and activeIds reconcile deletions", async () => {
  const expenses = entity("expenses");
  const saved = await expenses.Model.create(expenses.data);
  const boundary = new Date("2026-11-03T00:00:00.000Z");
  await expenses.Model.collection.updateOne({ _id: saved._id }, { $set: { updatedAt: boundary } });
  const delta = await request("GET", `/expenses/delta?since=${boundary.getTime()}`);
  assert.equal(delta.items[0]._id, String(saved._id));
  await request("DELETE", `/expenses/${saved._id}`);
  assert.deepEqual((await request("GET", `/expenses/delta?since=${delta.timestamp}`)).activeIds, []);
});

test("MongoDB account balances, rename and delete cascades match mobile accounting", async () => {
  await entity("expenses").Model.create(entity("expenses").data);
  await entity("income").Model.create(entity("income").data);
  await entity("transfers").Model.create(entity("transfers").data);
  const balances = await request("GET", "/accounts/balances");
  assert.equal(balances.accounts.find(({ name }) => name === "Cash").balance, 974.5);
  assert.equal(balances.accounts.find(({ name }) => name === "Bank").balance, 2400);
  assert.equal(balances.combinedBalance, 3374.5);

  const bank = await entity("accounts").Model.findOne({ name: "Bank" });
  assertSynced(await push(entity("accounts"), [{ id: 1, remoteId: String(bank._id), name: "Savings" }]));
  assert.equal((await entity("income").Model.findOne()).accountName, "Savings");
  assert.equal((await entity("transfers").Model.findOne()).fromAccountName, "Savings");
  await request("DELETE", `/accounts/${bank._id}`);
  assert.equal((await entity("income").Model.findOne()).accountName, null);
  assert.equal(await entity("transfers").Model.countDocuments(), 0);
  assert.equal((await entity("expenses").Model.findOne()).accountName, "Cash");
});

test("MongoDB category/subcategory changes cascade without changing another category's same-named subcategory", async () => {
  await entity("expenses").Model.create(entity("expenses").data);
  await entity("categories").Model.create({ name: "Work" });
  await entity("subcategories").Model.create({ categoryName: "Work", name: "Meals" });
  const otherExpense = await entity("expenses").Model.create({
    ...entity("expenses").data, category: "Work",
  });
  const sub = await entity("subcategories").Model.findOne({ categoryName: "Food" });
  await request("PUT", `/subcategories/${sub._id}`, { name: "Lunch" });
  assert.equal((await entity("expenses").Model.findOne({ category: "Food" })).subcategory, "Lunch");
  assert.equal((await entity("expenses").Model.findById(otherExpense._id)).subcategory, "Meals");
  await request("DELETE", `/subcategories/${sub._id}`);
  assert.equal((await entity("expenses").Model.findOne({ category: "Food" })).subcategory, null);

  const category = await entity("categories").Model.findOne({ name: "Food" });
  await entity("subcategories").Model.create({ categoryName: "Food", name: "Drinks" });
  assertSynced(await push(entity("categories"), [{ id: 1, remoteId: String(category._id), name: "Dining" }]));
  assert.ok(await entity("expenses").Model.exists({ category: "Dining" }));
  assert.ok(await entity("subcategories").Model.exists({ categoryName: "Dining", name: "Drinks" }));
  const nested = await request("GET", "/categories");
  assert.equal(nested.find(({ name }) => name === "Dining").subcategories[0].name, "Drinks");
  await request("DELETE", `/categories/${category._id}`);
  assert.ok(await entity("expenses").Model.exists({ category: "General", subcategory: null }));
  assert.equal(await entity("subcategories").Model.countDocuments({ categoryName: "Dining" }), 0);
  assert.equal((await entity("expenses").Model.findById(otherExpense._id)).subcategory, "Meals");
});
