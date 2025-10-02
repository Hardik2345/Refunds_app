# Changelog

All notable changes to this project will be documented in this file.

## 1.2.0 - 2025-10-02

Frontend
- AgentDashboard: Search selector now supports Phone or Order Name
- When using Order Name, the app queries Shopify via GraphQL and maps GIDs to numeric order and line item IDs so refunds work via REST
- Bulk preview no longer sends customer name; it sends only items (and optional phone when in phone mode)
- Refund request payload now requires either orderId or phone (phone only needed when orderId is omitted)
- Cashback tab header reflects the current search mode (phone vs order name)

Backend
- GET /api/v1/orders supports orderName query via GraphQL with robust matching:
  - Tries quoted name with and without leading #
  - Falls back to unquoted variants
  - Also tries order_number:<digits> when digits are present
- GraphQL order and line item GIDs are mapped to numeric IDs
- Phone search path unchanged (REST by customer_id)
- Refund execution accepts orderId or phone; name-based search removed
- Approve flow re-loads by phone or direct orderId
- Bulk preview accepts items with orderId and optional top-level phone; name removed

Rules engine
- buildRefundContext now requires phone or orderId (no customer name)
- Cashback fields from Flits included in meta: totalCredits, totalSpentCreditsRaw, totalSpentCredits (normalized)
- Evaluator enforces cashbackSpentThreshold (using raw), refundWindowDays, maxRefundPercent, maxRefundsPerDay, allowPaymentMethods, requireSupervisorAbovePercent, and blockIfAlreadyRefunded

Docs
- OpenAPI refunds spec bumped to 1.2.0; documents orderName support and relaxed RefundRequest requirements
- Refund-stats spec remains at 1.1.1; describes attempts ring buffer and populated tenant name

Notes
- When searching by order name, pass values like "#1234" or the exact Shopify display name; the server will try multiple variants automatically.
- If a specific order is known, send its numeric orderId in refund/preview APIs to skip customer resolution.
