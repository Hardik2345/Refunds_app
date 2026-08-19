# Refunds Service

Tenant-aware refunds service backed by Express + Mongoose with Shopify integration and a React/MUI frontend.

## Flits cashback

Set `FLITS_USER_ID` and `FLITS_API_KEY` to enable customer cashback lookups. Bulk refund preview deduplicates concurrent lookups by Shopify customer ID and uses a short Redis cache; configure its duration with `FLITS_CACHE_TTL_SECONDS` (30 seconds by default). Final refund execution bypasses this cashback cache and fetches fresh data.

## What’s new (v1.2.0)

- Search by Phone or Order Name in the Agent Dashboard.
- GET /api/v1/orders now supports `orderName` using Shopify GraphQL and maps GIDs to numeric IDs (orders and line items) so refunds via REST work.
- Bulk preview accepts `{ items }` and optional top-level `phone`; no customer name is used.
- Refunds accept either `orderId` or `phone` (phone required only if `orderId` is omitted).
- Rules engine enhancements and cashback policy remain in effect.

See CHANGELOG.md for detailed notes.

## API quick reference

- GET `/api/v1/orders` — list orders by query
  - Query params:
    - `phone` — list by customer phone (REST)
    - `orderName` — list by Shopify order name (GraphQL). The server tries with/without `#` and quoted variants; may fallback to `order_number:<digits>`.
    - `startDate`, `endDate`, `limit`, `page_info`
- POST `/api/v1/refund` — execute refund
  - Body: `{ orderId?, phone?, amount?, lineItems? }`
  - Requires either `orderId` or `phone`.
- POST `/api/v1/refund/preview/bulk` — dry-run rule evaluation
  - Body: `{ items: [{ orderId, amount?, lineItems? }], phone? }`

## Frontend usage tips

- Choose “Phone” to search by customer phone or “Order Name” to search by the Shopify display name (e.g., `#1234`).
- For refunds, if an order is selected from results, the app uses its numeric `orderId` for execution.

## Development

- Backend: Node/Express, Mongoose; Shopify REST + GraphQL
- Frontend: Vite + React + MUI
