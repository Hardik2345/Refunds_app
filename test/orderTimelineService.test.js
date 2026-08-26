const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeOrderEvents,
  fetchOrderEvents,
  clampPageSize,
  toOrderGid,
  MAX_PAGE_SIZE,
} = require("../services/shopifyOrderEventsService");

const tenant = {
  _id: "tenant-1",
  shopDomain: "example-shop",
  accessToken: "shpat_test",
  apiVersion: "2025-10",
};

function eventsPayload(nodes, pageInfo) {
  return {
    data: {
      order: {
        id: "gid://shopify/Order/123",
        events: {
          pageInfo: pageInfo || { hasNextPage: false, endCursor: null },
          nodes,
        },
      },
    },
  };
}

test("normalizes basic and comment events, including both author shapes", () => {
  const result = normalizeOrderEvents(
    eventsPayload([
      {
        __typename: "BasicEvent",
        id: "gid://shopify/BasicEvent/1",
        action: "refund_success",
        createdAt: "2026-08-25T09:41:26Z",
        message: "We successfully refunded <strong>₹166.20</strong>.",
        secondaryMessage: "<em>via Shopify Payments</em>",
        author: "Hardik P",
        appTitle: "Gokwik <> Bla Bli Blu",
        attributeToApp: true,
        attributeToUser: false,
        criticalAlert: false,
      },
      {
        __typename: "CommentEvent",
        id: "gid://shopify/CommentEvent/2",
        action: "comment",
        createdAt: "2026-08-25T09:30:00Z",
        message: "<p>Customer called about the delay</p>",
        rawMessage: "Customer called about the delay",
        author: { name: "Agent Two", email: "agent2@example.com" },
        attributeToApp: false,
        attributeToUser: true,
        criticalAlert: true,
      },
    ])
  );

  assert.equal(result.status, "ok");
  assert.equal(result.events.length, 2);

  const [basic, comment] = result.events;

  assert.equal(basic.type, "basic");
  assert.equal(basic.action, "refund_success");
  assert.equal(basic.text, "We successfully refunded ₹166.20.");
  assert.equal(basic.secondaryText, "via Shopify Payments");
  assert.equal(basic.author, "Hardik P");
  assert.equal(basic.appTitle, "Gokwik <> Bla Bli Blu");
  assert.equal(basic.attributeToApp, true);
  assert.equal(basic.criticalAlert, false);

  assert.equal(comment.type, "comment");
  assert.equal(comment.text, "Customer called about the delay");
  assert.equal(comment.author, "Agent Two");
  assert.equal(comment.secondaryText, null);
  assert.equal(comment.criticalAlert, true);
});

test("falls back to the staff member email when a comment author has no name", () => {
  const result = normalizeOrderEvents(
    eventsPayload([
      {
        __typename: "CommentEvent",
        id: "gid://shopify/CommentEvent/3",
        createdAt: "2026-08-25T09:30:00Z",
        message: "<p>note</p>",
        rawMessage: "note",
        author: { name: null, email: "agent3@example.com" },
      },
    ])
  );

  assert.equal(result.events[0].author, "agent3@example.com");
});

test("strips link markup but keeps the visible text", () => {
  const result = normalizeOrderEvents(
    eventsPayload([
      {
        __typename: "BasicEvent",
        id: "gid://shopify/BasicEvent/4",
        createdAt: "2026-08-25T09:00:00Z",
        message:
          'Confirmation <a href="https://admin.shopify.com/orders/123">#JE7D36T2M</a> was generated for this order.',
      },
    ])
  );

  assert.equal(
    result.events[0].text,
    "Confirmation #JE7D36T2M was generated for this order."
  );
});

test("passes pageInfo through for cursor pagination", () => {
  const result = normalizeOrderEvents(
    eventsPayload([], { hasNextPage: true, endCursor: "cursor-abc" })
  );

  assert.deepEqual(result.pageInfo, { hasNextPage: true, endCursor: "cursor-abc" });
});

test("treats GraphQL errors as unavailable instead of throwing", () => {
  const result = normalizeOrderEvents({
    errors: [{ message: "Field 'events' doesn't exist on type 'Order'" }],
  });

  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.events, []);
  assert.match(result.error, /doesn't exist/);
  assert.equal(result.details.length, 1);
});

test("classifies access-denied GraphQL errors as forbidden", () => {
  const result = normalizeOrderEvents({
    errors: [{ message: "Access denied for events field. Requires read_all_orders." }],
  });

  assert.equal(result.status, "forbidden");
});

test("returns an empty timeline when the order is not visible to the token", () => {
  const result = normalizeOrderEvents({ data: { order: null } });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.pageInfo, { hasNextPage: false, endCursor: null });
});

test("sends the order GID, page size and cursor to Shopify", async () => {
  let captured = null;
  const httpClient = {
    async post(url, body, config) {
      captured = { url, body, config };
      return { data: eventsPayload([]) };
    },
  };

  await fetchOrderEvents({
    tenant,
    orderId: 6234567890,
    limit: 5,
    cursor: "cursor-abc",
    httpClient,
  });

  assert.match(captured.url, /example-shop\.myshopify\.com\/admin\/api\/2025-10\/graphql\.json$/);
  assert.equal(captured.body.variables.id, "gid://shopify/Order/6234567890");
  assert.equal(captured.body.variables.first, 5);
  assert.equal(captured.body.variables.after, "cursor-abc");
  assert.equal(captured.config.headers["X-Shopify-Access-Token"], "shpat_test");
});

test("maps a Shopify 403 to the forbidden sentinel", async () => {
  const httpClient = {
    async post() {
      const err = new Error("Request failed with status code 403");
      err.response = { status: 403 };
      throw err;
    },
  };

  const result = await fetchOrderEvents({ tenant, orderId: 1, httpClient });

  assert.equal(result.status, "forbidden");
  assert.deepEqual(result.events, []);
});

test("maps a network failure to unavailable without throwing", async () => {
  const httpClient = {
    async post() {
      throw new Error("ETIMEDOUT");
    },
  };

  const result = await fetchOrderEvents({ tenant, orderId: 1, httpClient });

  assert.equal(result.status, "unavailable");
  assert.equal(result.error, "ETIMEDOUT");
});

test("reports missing tenant credentials as unavailable", async () => {
  const result = await fetchOrderEvents({ tenant: { shopDomain: "example-shop" }, orderId: 1 });

  assert.equal(result.status, "unavailable");
  assert.match(result.error, /credentials/);
});

test("clamps the page size and normalizes order ids", () => {
  assert.equal(clampPageSize(undefined), 20);
  assert.equal(clampPageSize(0), 20);
  assert.equal(clampPageSize("7"), 7);
  assert.equal(clampPageSize(500), MAX_PAGE_SIZE);
  assert.equal(toOrderGid(123), "gid://shopify/Order/123");
  assert.equal(toOrderGid("gid://shopify/Order/123"), "gid://shopify/Order/123");
});
