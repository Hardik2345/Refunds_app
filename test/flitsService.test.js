const test = require("node:test");
const assert = require("node:assert/strict");

const {
  getFlitsCashback,
  normalizeFlitsCashback,
} = require("../services/flitsService");

test("normalizes Flits balance and deductions without subtracting twice", () => {
  const summary = normalizeFlitsCashback(
    {
      customer: {
        credits: 47000,
        total_spent_credits: -134700,
      },
    },
    "customer-1"
  );

  assert.equal(summary.status, "available");
  assert.equal(summary.availableBalance, 470);
  assert.equal(summary.totalDeducted, 1347);
  assert.equal(summary.totalCredited, 1817);
  assert.equal(summary.totalDeductedRaw, -134700);
});

test("returns unavailable values instead of converting missing values to zero", () => {
  const summary = normalizeFlitsCashback({ customer: {} }, "customer-1");

  assert.equal(summary.status, "unavailable");
  assert.equal(summary.availableBalance, null);
  assert.equal(summary.totalDeducted, null);
  assert.equal(summary.totalCredited, null);
});

test("supports the top-level total_spent_credits fallback", () => {
  const summary = normalizeFlitsCashback(
    { customer: { credits: "10000" }, total_spent_credits: "-2500" },
    "customer-1"
  );

  assert.equal(summary.availableBalance, 100);
  assert.equal(summary.totalDeducted, 25);
  assert.equal(summary.totalCredited, 125);
});

test("deduplicates concurrent Flits calls for the same customer within a request", async () => {
  let callCount = 0;
  const httpClient = {
    async get() {
      callCount += 1;
      await new Promise((resolve) => setImmediate(resolve));
      return {
        data: {
          customer: { credits: 47000, total_spent_credits: -134700 },
        },
      };
    },
  };
  const requestCache = new Map();

  const summaries = await Promise.all(
    Array.from({ length: 10 }, () =>
      getFlitsCashback({
        tenantId: "tenant-1",
        customerId: "customer-1",
        requestCache,
        useRedisCache: false,
        httpClient,
        userId: "flits-user",
        apiKey: "flits-key",
      })
    )
  );

  assert.equal(callCount, 1);
  assert.equal(summaries.length, 10);
  assert.ok(summaries.every((summary) => summary.availableBalance === 470));
});

test("does not share a request across different customers", async () => {
  let callCount = 0;
  const httpClient = {
    async get() {
      callCount += 1;
      return { data: { customer: { credits: 10000, total_spent_credits: 0 } } };
    },
  };
  const requestCache = new Map();

  await Promise.all(
    ["customer-1", "customer-2", "customer-3"].map((customerId) =>
      getFlitsCashback({
        tenantId: "tenant-1",
        customerId,
        requestCache,
        useRedisCache: false,
        httpClient,
        userId: "flits-user",
        apiKey: "flits-key",
      })
    )
  );

  assert.equal(callCount, 3);
});

test("reports missing Flits credentials as not configured", async () => {
  const previousUserId = process.env.FLITS_USER_ID;
  const previousApiKey = process.env.FLITS_API_KEY;
  delete process.env.FLITS_USER_ID;
  delete process.env.FLITS_API_KEY;

  try {
    const summary = await getFlitsCashback({ customerId: "customer-1" });
    assert.equal(summary.status, "not_configured");
    assert.equal(summary.availableBalance, null);
  } finally {
    if (previousUserId === undefined) delete process.env.FLITS_USER_ID;
    else process.env.FLITS_USER_ID = previousUserId;
    if (previousApiKey === undefined) delete process.env.FLITS_API_KEY;
    else process.env.FLITS_API_KEY = previousApiKey;
  }
});
