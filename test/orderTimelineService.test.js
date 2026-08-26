const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizeOrderEvents,
  normalizeOrderDetail,
  normalizeAdditionalContent,
  fetchOrderEvents,
  fetchOrderDetail,
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

// ---------------------------------------------------------------------------
// Order detail: header + line items + first page of events, one request
// ---------------------------------------------------------------------------

function money(amount, currencyCode) {
  return { presentmentMoney: { amount, currencyCode: currencyCode || "INR" } };
}

function detailPayload(overrides) {
  return {
    data: {
      order: {
        id: "gid://shopify/Order/6234567890",
        name: "#BBB2531196",
        createdAt: "2026-08-26T06:20:00Z",
        cancelledAt: null,
        displayFinancialStatus: "PARTIALLY_REFUNDED",
        displayFulfillmentStatus: "UNFULFILLED",
        currencyCode: "INR",
        note: null,
        tags: ["cod"],
        subtotalPriceSet: money("399.00"),
        totalShippingPriceSet: money("0.00"),
        totalTaxSet: money("0.00"),
        totalPriceSet: money("399.00"),
        totalRefundedSet: money("166.20"),
        shippingLine: { title: "Free Shipping", discountedPriceSet: money("0.00") },
        lineItems: {
          pageInfo: { hasNextPage: false },
          nodes: [
            {
              id: "gid://shopify/LineItem/14567890123",
              name: "Pack For Men - 7ml X 6 Parfums",
              title: "Pack For Men",
              variantTitle: "7ml X 6 Parfums",
              sku: "8908027132006",
              quantity: 3,
              currentQuantity: 2,
              refundableQuantity: 2,
              originalUnitPriceSet: money("449.00"),
              discountedUnitPriceSet: money("399.00"),
              discountedTotalSet: money("1197.00"),
              image: { url: "https://cdn.shopify.com/variant.webp", altText: "Perfume box" },
              product: {
                featuredMedia: {
                  preview: { image: { url: "https://cdn.shopify.com/product.webp", altText: null } },
                },
              },
            },
          ],
        },
        events: {
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          nodes: [
            {
              __typename: "BasicEvent",
              id: "gid://shopify/BasicEvent/9",
              action: "capture_success",
              createdAt: "2026-08-26T06:21:00Z",
              message: "Gokwik captured <strong>₹600.00 INR</strong> on Gokwik Upi.",
              hasAdditionalContent: true,
              additionalContent: [{ label: "Gateway", value: "Gokwik Upi" }],
            },
          ],
        },
        ...(overrides || {}),
      },
    },
  };
}

test("normalizes the order header, including lowercased statuses and totals", () => {
  const result = normalizeOrderDetail(detailPayload());

  assert.equal(result.status, "ok");
  assert.equal(result.order.id, 6234567890);
  assert.equal(result.order.name, "#BBB2531196");
  assert.equal(result.order.financialStatus, "partially_refunded");
  assert.equal(result.order.fulfillmentStatus, "unfulfilled");
  assert.equal(result.order.currencyCode, "INR");
  assert.deepEqual(result.order.tags, ["cod"]);
  assert.deepEqual(result.order.shipping, {
    title: "Free Shipping",
    price: { amount: "0.00", currencyCode: "INR" },
  });
  assert.deepEqual(result.order.totals.subtotal, { amount: "399.00", currencyCode: "INR" });
  assert.deepEqual(result.order.totals.total, { amount: "399.00", currencyCode: "INR" });
  assert.deepEqual(result.order.totals.refunded, { amount: "166.20", currencyCode: "INR" });
});

test("normalizes a line item with its numeric id, prices and thumbnail", () => {
  const result = normalizeOrderDetail(detailPayload());

  assert.equal(result.lineItems.length, 1);
  const [item] = result.lineItems;

  assert.equal(item.id, 14567890123);
  assert.equal(item.name, "Pack For Men - 7ml X 6 Parfums");
  assert.equal(item.variantTitle, "7ml X 6 Parfums");
  assert.equal(item.sku, "8908027132006");
  assert.equal(item.quantity, 3);
  assert.equal(item.currentQuantity, 2);
  assert.equal(item.refundableQuantity, 2);
  // Discounted unit price wins — it is the number Shopify shows as "₹399.00 × 3".
  assert.deepEqual(item.unitPrice, { amount: "399.00", currencyCode: "INR" });
  assert.deepEqual(item.lineTotal, { amount: "1197.00", currencyCode: "INR" });
  assert.equal(item.imageUrl, "https://cdn.shopify.com/variant.webp");
  assert.equal(item.imageAlt, "Perfume box");
  assert.equal(result.hasMoreLineItems, false);
});

test("falls back to the product featured image when the variant has none", () => {
  const payload = detailPayload();
  payload.data.order.lineItems.nodes[0].image = null;

  const [item] = normalizeOrderDetail(payload).lineItems;

  assert.equal(item.imageUrl, "https://cdn.shopify.com/product.webp");
  assert.equal(item.imageAlt, null);
});

test("leaves imageUrl null when neither the variant nor the product has an image", () => {
  const payload = detailPayload();
  payload.data.order.lineItems.nodes[0].image = null;
  payload.data.order.lineItems.nodes[0].product = null;

  const [item] = normalizeOrderDetail(payload).lineItems;

  assert.equal(item.imageUrl, null);
  // An imported line item still has to render its name and quantity.
  assert.equal(item.name, "Pack For Men - 7ml X 6 Parfums");
  assert.equal(item.quantity, 3);
});

test("flags line items beyond the first page", () => {
  const payload = detailPayload();
  payload.data.order.lineItems.pageInfo = { hasNextPage: true };

  assert.equal(normalizeOrderDetail(payload).hasMoreLineItems, true);
});

test("returns the first page of events alongside the order", () => {
  const result = normalizeOrderDetail(detailPayload());

  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].text, "Gokwik captured ₹600.00 INR on Gokwik Upi.");
  assert.deepEqual(result.events[0].detailLines, ["Gateway: Gokwik Upi"]);
  assert.deepEqual(result.pageInfo, { hasNextPage: true, endCursor: "cursor-1" });
});

test("ignores additionalContent when the event does not advertise any", () => {
  const payload = detailPayload();
  payload.data.order.events.nodes[0].hasAdditionalContent = false;

  assert.deepEqual(normalizeOrderDetail(payload).events[0].detailLines, []);
});

test("flattens the shapes additionalContent actually arrives in", () => {
  assert.deepEqual(normalizeAdditionalContent("<p>Paid via UPI</p>"), ["Paid via UPI"]);
  assert.deepEqual(normalizeAdditionalContent(["One", "<em>Two</em>"]), ["One", "Two"]);
  assert.deepEqual(
    normalizeAdditionalContent([{ label: "Card", value: "•••• 4242" }]),
    ["Card: •••• 4242"]
  );
  assert.deepEqual(normalizeAdditionalContent(null), []);
  assert.deepEqual(normalizeAdditionalContent(42), ["42"]);
  assert.deepEqual(normalizeAdditionalContent({}), []);
});

test("detail: GraphQL errors and access denials keep the sentinel shape", () => {
  const unavailable = normalizeOrderDetail({ errors: [{ message: "Internal error" }] });
  assert.equal(unavailable.status, "unavailable");
  assert.equal(unavailable.order, null);
  assert.deepEqual(unavailable.lineItems, []);
  assert.deepEqual(unavailable.events, []);

  const denied = normalizeOrderDetail({
    errors: [{ message: "This app is not approved to access the Order object." }],
  });
  assert.equal(denied.status, "forbidden");
  assert.equal(denied.order, null);
});

test("detail: an invisible order is an empty success, not a failure", () => {
  const result = normalizeOrderDetail({ data: { order: null } });

  assert.equal(result.status, "ok");
  assert.equal(result.order, null);
  assert.deepEqual(result.lineItems, []);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.pageInfo, { hasNextPage: false, endCursor: null });
});

test("fetchOrderDetail asks for the detail document with no cursor", async () => {
  let captured = null;
  const httpClient = {
    async post(url, body, config) {
      captured = { url, body, config };
      return { data: detailPayload() };
    },
  };

  const result = await fetchOrderDetail({ tenant, orderId: 6234567890, limit: 20, httpClient });

  assert.equal(result.status, "ok");
  assert.match(captured.body.query, /query OrderDetail/);
  assert.match(captured.body.query, /lineItems\(first: 50\)/);
  assert.match(captured.body.query, /maxWidth: 160/);
  assert.equal(captured.body.variables.id, "gid://shopify/Order/6234567890");
  assert.equal(captured.body.variables.first, 20);
  assert.equal(captured.body.variables.after, undefined);
  assert.equal(captured.config.headers["X-Shopify-Access-Token"], "shpat_test");
});

test("fetchOrderDetail maps a Shopify 403 to the forbidden sentinel", async () => {
  const httpClient = {
    async post() {
      const err = new Error("Request failed with status code 403");
      err.response = { status: 403 };
      throw err;
    },
  };

  const result = await fetchOrderDetail({ tenant, orderId: 1, httpClient });

  assert.equal(result.status, "forbidden");
  assert.equal(result.order, null);
  assert.deepEqual(result.lineItems, []);
});

test("clamps the page size and normalizes order ids", () => {
  assert.equal(clampPageSize(undefined), 20);
  assert.equal(clampPageSize(0), 20);
  assert.equal(clampPageSize("7"), 7);
  assert.equal(clampPageSize(500), MAX_PAGE_SIZE);
  assert.equal(toOrderGid(123), "gid://shopify/Order/123");
  assert.equal(toOrderGid("gid://shopify/Order/123"), "gid://shopify/Order/123");
});
