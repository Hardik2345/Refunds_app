const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAuditFilter } = require("../controllers/userAuditController");

const STORE = "665f1c2a9b1e4d0012a3b4c5";
const tenant = { _id: STORE, name: "Bla Bli Blu" };

test("scopes a super_admin strictly to its own store", () => {
  const filter = buildAuditFilter({ tenant, role: "super_admin" });

  assert.equal(filter.tenant, STORE);
  assert.equal(filter.$or, undefined);
});

test("lets cross-tenant admins see platform-level rows alongside the selected store", () => {
  for (const role of ["platform_admin", "user_admin"]) {
    const filter = buildAuditFilter({ tenant, role });

    // Platform admins have no storeId, so acting on one writes `tenant: null`;
    // a plain equality match on the store id used to hide those rows entirely.
    assert.deepEqual(filter.$or, [{ tenant: STORE }, { tenant: null }], role);
    assert.equal(filter.tenant, undefined, role);
  }
});

test("applies no tenant filter at all in the x-tenant-id: ALL case", () => {
  const filter = buildAuditFilter({ tenant: null, role: "platform_admin" });

  assert.equal(filter.tenant, undefined);
  assert.equal(filter.$or, undefined);
  assert.deepEqual(filter, {});
});

test("honours an explicit tenant param when no tenant is attached", () => {
  const scoped = buildAuditFilter({ query: { tenant: STORE }, role: "platform_admin" });
  assert.deepEqual(scoped.$or, [{ tenant: STORE }, { tenant: null }]);

  const strict = buildAuditFilter({ query: { tenant: STORE }, role: "super_admin" });
  assert.equal(strict.tenant, STORE);
});

test("the attached tenant wins over an explicit tenant param", () => {
  const filter = buildAuditFilter({
    query: { tenant: "000000000000000000000000" },
    tenant,
    role: "super_admin",
  });

  assert.equal(filter.tenant, STORE);
});

test("passes the action, actor and targetUser filters through", () => {
  const filter = buildAuditFilter({
    query: { action: "USER_DELETED", actor: "actor-1", targetUser: "target-1" },
    role: "platform_admin",
  });

  assert.equal(filter.action, "USER_DELETED");
  assert.equal(filter.actor, "actor-1");
  assert.equal(filter.targetUser, "target-1");
});

test("builds a createdAt range from from/to and omits it otherwise", () => {
  const ranged = buildAuditFilter({
    query: { from: "2026-08-01T00:00:00Z", to: "2026-08-26T00:00:00Z" },
    role: "platform_admin",
  });

  assert.equal(ranged.createdAt.$gte.toISOString(), "2026-08-01T00:00:00.000Z");
  assert.equal(ranged.createdAt.$lte.toISOString(), "2026-08-26T00:00:00.000Z");

  assert.equal(buildAuditFilter({ role: "platform_admin" }).createdAt, undefined);
});

test("keeps the tenant widening and the date range side by side", () => {
  const filter = buildAuditFilter({
    query: { from: "2026-08-01T00:00:00Z" },
    tenant,
    role: "platform_admin",
  });

  assert.deepEqual(filter.$or, [{ tenant: STORE }, { tenant: null }]);
  assert.ok(filter.createdAt.$gte instanceof Date);
});

test("survives being called with no arguments", () => {
  assert.deepEqual(buildAuditFilter(), {});
});
