import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import path from "node:path";
import { afterEach, mock, test } from "node:test";
import mongoose from "mongoose";
import app from "../App.js";
import { entities, entity } from "./fixtures.js";
import { errorHandler } from "../Utils/http.js";
import { parseSince, runSyncBatch, buildSyncFilter } from "../Utils/sync.js";
import {
  detachAccountRefs, renameAccountRefs, detachCategoryRefs,
  renameCategoryRefs, detachSubcategoryRefs, renameSubcategoryRefs,
} from "../Utils/cascade.js";

afterEach(() => mock.restoreAll());

const mobileSchema = readFileSync(path.resolve(
  import.meta.dirname, "..", "..", "..", "Mobile", "src", "lib", "db", "schema.js",
), "utf8").replace(/\r/g, "").replace(/\/\/[^\n]*/g, "");
const mobileTables = [...mobileSchema.matchAll(
  /sqliteTable\("([^"]+)", \{([\s\S]*?)\n\}\);/g,
)];
const mappedNames = {
  accountId: "accountName", categoryId: "categoryName",
  fromAccountId: "fromAccountName", toAccountId: "toAccountName",
};
const bookkeeping = new Set(["id", "remoteId", "syncStatus", "createdAt"]);
const remoteId = "507f1f77bcf86cd799439011";

const queryResult = (value) => ({
  lean: async () => value,
  collation: () => ({ lean: async () => value }),
});

// Invoke the real route handler without opening a socket. Database calls are mocked explicitly.
const invoke = async (router, method, route, request = {}) => {
  const layer = router.stack.find((item) =>
    item.route?.path === route && item.route.methods[method],
  );
  assert.ok(layer, `${method.toUpperCase()} ${route} is registered`);
  const req = { body: undefined, query: {}, params: {}, method, originalUrl: route, ...request };
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = JSON.parse(JSON.stringify(body)); return this; },
  };
  try {
    await layer.route.stack[0].handle(req, res);
  } catch (error) {
    errorHandler(error, req, res, (unhandled) => { throw unhandled; });
  }
  return res;
};

const allowReferences = () => {
  mock.method(entity("accounts").Model, "exists", async () => ({ _id: remoteId }));
  mock.method(entity("categories").Model, "exists", async () => ({ _id: remoteId }));
  mock.method(entity("subcategories").Model, "findOne", () => queryResult(null));
  mock.method(entity("subcategories").Model, "find", () => queryResult([]));
};

test("every current mobile SQLite table has a backend model and routes", () => {
  assert.equal(mobileTables.length, 8);
  assert.deepEqual(
    mobileTables.map(([ , name]) => name).sort(),
    entities.map(({ table }) => table).sort(),
  );
});

for (const { table, Model, router, bodyKey, data } of entities) {
  const [, , columns] = mobileTables.find(([, name]) => name === table);
  const fields = [...columns.matchAll(/^\s*(\w+): (text|integer|real)\("[^"]+"\)([\s\S]*?)(?=,\s*\n)/gm)]
    .map(([, name, type, definition]) => ({ name, type, definition }))
    .filter(({ name }) => !bookkeeping.has(name));

  test(`${table}: fields, types, nullability and defaults match the mobile schema`, async () => {
    assert.deepEqual(Object.keys(data).sort(), fields.map(({ name }) => mappedNames[name] || name).sort());
    for (const { name, type, definition } of fields) {
      const serverName = mappedNames[name] || name;
      const schemaType = Model.schema.path(serverName);
      assert.ok(schemaType, `${table}.${name} -> ${serverName}`);
      assert.equal(schemaType.instance, mappedNames[name] || type === "text" ? "String" : "Number");
      assert.equal(Boolean(schemaType.isRequired), definition.includes(".notNull()"), serverName);

      const nullable = new Model({ ...data, [serverName]: null });
      if (definition.includes(".notNull()")) {
        await assert.rejects(nullable.validate(), /required/);
      } else {
        await nullable.validate();
        assert.equal(nullable[serverName], null);
      }
    }
    assert.ok(Model.schema.options.timestamps);
    const record = new Model(data);
    await record.validate();
    for (const [field, value] of Object.entries(data)) assert.equal(record[field], value);
    const minimal = Object.fromEntries(fields
      .filter(({ definition }) => definition.includes(".notNull()") && !definition.includes(".default("))
      .map(({ name }) => [mappedNames[name] || name, data[mappedNames[name] || name]]));
    const defaults = new Model(minimal);
    await defaults.validate();
    if (table === "accounts") {
      assert.equal(defaults.type, "Cash");
      assert.equal(defaults.initialBalance, 0);
    }
  });

  test(`${table}: sync forwards every mapped mobile field and returns client-compatible acknowledgements`, async () => {
    allowReferences();
    let written;
    mock.method(Model, "findOneAndUpdate", async (filter, update, options) => {
      assert.equal(options.upsert, true);
      assert.equal(options.runValidators, true);
      assert.equal(options.sanitizeFilter, true);
      assert.equal(options.returnDocument, "after");
      written = update.$set;
      const doc = new Model({ ...filter, ...written, _id: remoteId });
      await doc.validate();
      return doc;
    });
    const res = await invoke(router, "post", "/sync", {
      body: { [bodyKey]: [{ id: 7, ...data, syncStatus: "pending", unknown: "discard" }] },
    });
    assert.deepEqual(res.body, {
      success: true, syncedIds: [{ localId: 7, remoteId }], failed: [],
    });
    assert.deepEqual(written, data);
  });

  test(`${table}: sync rejects a missing batch and continues after an invalid row`, async () => {
    allowReferences();
    mock.method(Model, "findOneAndUpdate", async () => ({ _id: remoteId }));
    mock.method(console, "error", () => {});
    const missing = await invoke(router, "post", "/sync");
    assert.equal(missing.statusCode, 400);
    const res = await invoke(router, "post", "/sync", {
      body: { [bodyKey]: [null, { id: 1 }, { id: 2, ...data }] },
    });
    assert.equal(res.body.success, false);
    assert.equal(res.body.failed.length, 2);
    assert.deepEqual(res.body.syncedIds, [{ localId: 2, remoteId }]);
  });

  test(`${table}: delta exposes all data, timestamps, and string activeIds`, async () => {
    const row = { _id: new mongoose.Types.ObjectId(remoteId), ...data, updatedAt: new Date(1000) };
    const filters = [];
    mock.method(Model, "find", (filter) => {
      filters.push(filter);
      return { select: () => ({ lean: async () => [row] }) };
    });
    const res = await invoke(router, "get", "/delta", { query: { since: "1000" } });
    assert.equal(res.statusCode, 200);
    assert.equal(typeof res.body.timestamp, "number");
    assert.deepEqual(res.body.activeIds, [remoteId]);
    for (const [key, value] of Object.entries(data)) assert.equal(res.body.items[0][key], value);
    if (table === "budgets") assert.deepEqual(filters, [{}]);
    else assert.deepEqual(filters, [{ updatedAt: { $gte: new Date(1000) } }, {}]);
  });
}

test("sync accepts fractional web row IDs but rejects non-positive or structured IDs", async () => {
  mock.method(console, "error", () => {});
  const result = await runSyncBatch(
    [0, -1, Infinity, "7", {}, [], null, 1700000000000.25].map((id) => ({ id })),
    "test", async () => ({ _id: remoteId }),
  );
  assert.equal(result.failed.length, 7);
  assert.deepEqual(result.syncedIds, [{ localId: 1700000000000.25, remoteId }]);
});

test("delta rejects invalid or out-of-range timestamps instead of throwing a 500", async () => {
  for (const since of ["NaN", "-1", "1e30", "8640000000000001", "1.5", []]) {
    assert.equal(parseSince(since), null);
    const res = await invoke(entity("expenses").router, "get", "/delta", { query: { since } });
    assert.equal(res.statusCode, 400);
  }
  assert.equal(parseSince(undefined).getTime(), 0);
  assert.equal(parseSince("1000").getTime(), 1000);
});

test("remoteId takes precedence and malformed remoteIds cannot form database filters", () => {
  assert.deepEqual(buildSyncFilter({ remoteId }, { title: "ignored" }), { _id: remoteId });
  for (const value of ["invalid", {}, { $ne: null }]) {
    assert.throws(() => buildSyncFilter({ remoteId: value }, {}), /Invalid remoteId/);
  }
});

test("expense and fuel sync preserve fields omitted by older clients, and accept explicit null/zero", async () => {
  for (const table of ["expenses", "fuel_logs"]) {
    const { Model, router, bodyKey, data } = entity(table);
    const payload = table === "expenses"
      ? { title: data.title, amount: 0, month: data.month, method: null }
      : { startKm: 0, litres: 5, pricePerLitre: 100, totalCost: 500, date: data.date, month: data.month };
    let written;
    mock.method(Model, "findOneAndUpdate", async (filter, update) => {
      assert.deepEqual(filter, { _id: remoteId });
      written = update.$set;
      return { _id: remoteId };
    });
    const res = await invoke(router, "post", "/sync", {
      body: { [bodyKey]: [{ id: 1, remoteId, ...payload }] },
    });
    assert.equal(res.body.success, true);
    assert.deepEqual(written, payload);
  }
});

test("expense, income and transfer first-push filters distinguish identical local rows", async () => {
  allowReferences();
  for (const table of ["expenses", "income", "transfers"]) {
    const { Model, router, bodyKey, data } = entity(table);
    const filters = [];
    mock.method(Model, "findOneAndUpdate", async (filter) => {
      filters.push(filter);
      return { _id: remoteId };
    });
    await invoke(router, "post", "/sync", {
      body: { [bodyKey]: [{ id: 1, ...data }, { id: 2, ...data }] },
    });
    assert.equal(filters[0].clientId, 1);
    assert.equal(filters[1].clientId, 2);
  }
});

test("name references are validated on REST and sync writes", async () => {
  mock.method(console, "error", () => {});
  mock.method(entity("accounts").Model, "exists", async () => null);
  mock.method(entity("categories").Model, "exists", async () => null);
  for (const table of ["expenses", "income", "transfers", "subcategories"]) {
    const { router, bodyKey, data } = entity(table);
    const rest = await invoke(router, "post", "/", { body: data });
    assert.ok([400, 404].includes(rest.statusCode));
    const sync = await invoke(router, "post", "/sync", {
      body: { [bodyKey]: [{ id: 1, ...data }] },
    });
    assert.equal(sync.body.success, false);
    assert.match(sync.body.failed[0].error, /Unknown (account|category)/);
  }
});

test("subcategory retry excludes itself from duplicate checks; a parent move is rejected", async () => {
  mock.method(console, "error", () => {});
  mock.method(entity("categories").Model, "exists", async () => ({ _id: remoteId }));
  const { Model, router, data } = entity("subcategories");
  mock.method(Model, "findOne", () => queryResult({ _id: remoteId, ...data }));
  mock.method(Model, "find", () => queryResult([{ _id: remoteId, ...data }]));
  mock.method(Model, "findOneAndUpdate", async () => ({ _id: remoteId, ...data }));
  const retry = await invoke(router, "post", "/sync", {
    body: { subcategories: [{ id: 1, ...data }] },
  });
  assert.equal(retry.body.success, true);
  const moved = await invoke(router, "post", "/sync", {
    body: { subcategories: [{ id: 1, remoteId, ...data, categoryName: "Other" }] },
  });
  assert.match(moved.body.failed[0].error, /cannot change its parent/);
});

test("mobile uniqueness constraints are represented by MongoDB unique indexes", () => {
  for (const [table, keys] of [
    ["budgets", { month: 1 }],
    ["accounts", { name: 1 }],
    ["categories", { name: 1 }],
    ["subcategories", { categoryName: 1, name: 1 }],
  ]) {
    assert.ok(entity(table).Model.schema.indexes().some(
      ([fields, options]) => options.unique && JSON.stringify(fields) === JSON.stringify(keys),
    ), `${table} unique index`);
  }
});

test("subcategory duplicate checks use an exact parent and a case-insensitive sibling name", async () => {
  mock.method(entity("categories").Model, "exists", async () => ({ _id: remoteId }));
  const { Model, router } = entity("subcategories");
  let parentFilter;
  mock.method(Model, "find", (filter) => {
    parentFilter = filter;
    return queryResult([{ _id: remoteId, name: "Meals" }]);
  });
  const res = await invoke(router, "post", "/", { body: { categoryName: "Food", name: "meals" } });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(parentFilter, { categoryName: "Food" });
});

test("budget requires month and amount before writing; its sync still matches by month", async () => {
  const { Model, router } = entity("budgets");
  for (const body of [undefined, {}, { month: "2026-11" }, { amount: 50 }]) {
    const res = await invoke(router, "post", "/", { body });
    assert.equal(res.statusCode, 400);
  }
  let filter;
  mock.method(Model, "findOneAndUpdate", async (query) => {
    filter = query;
    return { _id: remoteId };
  });
  const res = await invoke(router, "post", "/sync", {
    body: { budgets: [{ id: 1, remoteId, month: "2026-11", amount: 0 }] },
  });
  assert.equal(res.body.success, true);
  assert.deepEqual(filter, { month: "2026-11" });
});

test("account REST does not silently turn invalid balances into zero", async () => {
  const { Model, router } = entity("accounts");
  mock.method(Model, "findOne", () => queryResult(null));
  mock.method(Model, "create", async (data) => {
    const doc = new Model(data);
    await doc.validate();
    return doc;
  });
  const bad = await invoke(router, "post", "/", { body: { name: "Cash", initialBalance: "bad" } });
  assert.equal(bad.statusCode, 400);
  const good = await invoke(router, "post", "/", { body: { name: "Cash" } });
  assert.equal(good.statusCode, 201);
  assert.equal(good.body.initialBalance, 0);
});

test("transfer validation rejects same-account and non-positive transfers", async () => {
  allowReferences();
  mock.method(console, "error", () => {});
  const { Model, router, data } = entity("transfers");
  for (const amount of [0, -1]) {
    await assert.rejects(new Model({ ...data, amount }).validate(), /greater than zero/);
  }
  await assert.rejects(new Model({ ...data, fromAccountName: "Cash" }).validate(), /must be different/);
  const res = await invoke(router, "post", "/sync", {
    body: { transfers: [{ id: 1, ...data, fromAccountName: "Cash" }] },
  });
  assert.match(res.body.failed[0].error, /must be different/);
});

test("expense list supports all records and the existing web month filter", async () => {
  const { Model, router } = entity("expenses");
  const filters = [];
  mock.method(Model, "find", (filter) => {
    filters.push(filter);
    return { sort: async () => [] };
  });
  await invoke(router, "get", "/");
  await invoke(router, "get", "/", { query: { month: "2026-11", accountName: "Cash" } });
  assert.deepEqual(filters, [{}, { month: "2026-11", accountName: "Cash" }]);
});

test("account balance matches the mobile income/expense/transfer formula", async () => {
  const accounts = entity("accounts");
  mock.method(accounts.Model, "find", () => ({
    sort: () => ({ lean: async () => [{ name: "Cash", initialBalance: 1000 }, { name: "Bank", initialBalance: 500 }] }),
  }));
  mock.method(entity("expenses").Model, "aggregate", async () => [{ _id: "Cash", total: 125.5 }]);
  mock.method(entity("income").Model, "aggregate", async () => [{ _id: "Bank", total: 2000 }]);
  mock.method(entity("transfers").Model, "aggregate", async (pipeline) =>
    [{ _id: pipeline[1].$group._id === "$toAccountName" ? "Cash" : "Bank", total: 100 }],
  );
  const res = await invoke(accounts.router, "get", "/balances");
  assert.deepEqual(res.body.accounts.map(({ balance }) => balance), [974.5, 2400]);
  assert.equal(res.body.combinedBalance, 3374.5);
});

test("name-based cascades target the correct account/category and preserve unrelated records", async () => {
  const writes = [];
  for (const table of ["expenses", "income", "transfers", "subcategories"]) {
    const { Model } = entity(table);
    for (const method of ["updateMany", "deleteMany"]) {
      mock.method(Model, method, async (...args) => { writes.push([table, method, ...args]); });
    }
  }
  await renameAccountRefs("Cash", "Wallet");
  assert.equal(writes.length, 4);
  assert.deepEqual(writes[0], ["expenses", "updateMany", { accountName: "Cash" }, { $set: { accountName: "Wallet" } }]);
  writes.length = 0;
  await detachAccountRefs("Cash");
  assert.deepEqual(writes, [
    ["expenses", "updateMany", { accountName: "Cash" }, { $set: { accountName: null } }],
    ["income", "updateMany", { accountName: "Cash" }, { $set: { accountName: null } }],
    ["transfers", "deleteMany", { $or: [{ fromAccountName: "Cash" }, { toAccountName: "Cash" }] }],
  ]);
  writes.length = 0;
  await renameCategoryRefs("Food", "Dining");
  await detachCategoryRefs("Dining");
  assert.deepEqual(writes, [
    ["expenses", "updateMany", { category: "Food" }, { $set: { category: "Dining" } }],
    ["subcategories", "updateMany", { categoryName: "Food" }, { $set: { categoryName: "Dining" } }],
    ["expenses", "updateMany", { category: "Dining" }, { $set: { category: "General", subcategory: null } }],
    ["subcategories", "deleteMany", { categoryName: "Dining" }],
  ]);
  writes.length = 0;
  await renameSubcategoryRefs("Food", "Meals", "Lunch");
  await detachSubcategoryRefs("Food", "Lunch");
  assert.deepEqual(writes, [
    ["expenses", "updateMany", { category: "Food", subcategory: "Meals" }, { $set: { subcategory: "Lunch" } }],
    ["expenses", "updateMany", { category: "Food", subcategory: "Lunch" }, { $set: { subcategory: null } }],
  ]);
});

// Dispatch through the real Express app using in-memory request/response objects (no socket).
const requestApp = (method, url) => new Promise((resolve, reject) => {
  const req = new IncomingMessage(new Socket());
  Object.assign(req, { method, url, headers: {} });
  const res = new ServerResponse(req);
  res.end = (chunk) => {
    resolve({ status: res.statusCode, headers: res.getHeaders(), body: chunk ? String(chunk) : "" });
    return res;
  };
  app(req, res, reject);
});

test("GET and HEAD /health are uncached liveness probes that never query the database", async () => {
  const touched = [];
  for (const { Model } of entities) {
    for (const operation of ["find", "findOne", "countDocuments", "exists"]) {
      mock.method(Model, operation, () => { touched.push(`${Model.modelName}.${operation}`); });
    }
  }

  const get = await requestApp("GET", "/health");
  assert.equal(get.status, 200);
  assert.equal(get.headers["cache-control"], "no-store");
  const payload = JSON.parse(get.body);
  assert.equal(payload.status, "ok");
  assert.equal(payload.database, "disconnected");
  assert.ok(Number.isInteger(payload.uptime) && payload.uptime >= 0);

  Object.defineProperty(mongoose.connection, "readyState", { configurable: true, get: () => 1 });
  try {
    assert.equal(JSON.parse((await requestApp("GET", "/health")).body).database, "connected");
  } finally {
    delete mongoose.connection.readyState;
  }

  const head = await requestApp("HEAD", "/health");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.deepEqual(touched, []);
});
