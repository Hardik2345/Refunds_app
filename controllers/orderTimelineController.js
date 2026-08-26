const { getOrderEvents, DEFAULT_PAGE_SIZE } = require("../services/shopifyOrderEventsService");

// Accepts either a numeric Shopify order id or a full Order GID.
const ORDER_ID_PATTERN = /^(?:gid:\/\/shopify\/Order\/)?\d+$/;

/**
 * GET /api/v1/orders/:orderId/timeline
 *
 * Read-only proxy over the Shopify Admin GraphQL `Order.events` connection —
 * the same data that backs the Timeline panel in Shopify admin.
 */
exports.getOrderTimeline = async (req, res) => {
  // platform_admin/user_admin can send `x-tenant-id: ALL`, in which case
  // tenantMiddleware intentionally leaves req.tenant unset.
  if (!req.tenant) {
    return res.status(400).json({ error: "Select a specific store to view an order timeline." });
  }

  const { orderId } = req.params;
  if (!ORDER_ID_PATTERN.test(String(orderId || ""))) {
    return res.status(400).json({ error: "Invalid orderId." });
  }

  try {
    const result = await getOrderEvents({
      tenant: req.tenant,
      orderId,
      limit: req.query.limit || DEFAULT_PAGE_SIZE,
      cursor: req.query.cursor || null,
      useRedisCache: true,
    });

    if (result.status === "forbidden") {
      return res.status(403).json({
        error:
          "Shopify denied access to this order's events. Orders older than 60 days require the read_all_orders scope.",
      });
    }

    if (result.status !== "ok") {
      return res.status(502).json({
        error: "Failed to fetch the order timeline from Shopify.",
        details: {
          message: result.error || null,
          graphqlErrors: result.details || null,
        },
      });
    }

    return res.status(200).json({ events: result.events, pageInfo: result.pageInfo });
  } catch (err) {
    console.error(`[orderTimeline] failed for order ${orderId}:`, err.message);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
