// append-order-tags.ts
const fetch = require('node-fetch');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';

/**
 * Append or overwrite tags on a Shopify order (Admin GraphQL).
 * - If overwrite=false (default): uses tagsAdd to merge tags (no read needed).
 * - If overwrite=true: uses orderUpdate(input: { id, tags }) to REPLACE the full tag list with tagsToAdd.
 * 
 * @param shopDomain your shop subdomain (without protocol), e.g. "acme-store"
 * @param accessToken Admin API access token
 * @param orderId numeric ID (123...) or GID ("gid://shopify/Order/...")
 * @param tagsToAdd string[]
 * @param overwrite if true, replaces tags with tagsToAdd
 */
async function appendOrderTags({
  shopDomain,
  accessToken,
  orderId,
  tagsToAdd = [],
  overwrite = false,
}) {
  if (!shopDomain || !accessToken || !orderId || !Array.isArray(tagsToAdd)) {
    throw new Error('appendOrderTags: missing required params');
  }

  // Normalize to a GID
  const gid = String(orderId).startsWith('gid://')
    ? String(orderId)
    : `gid://shopify/Order/${orderId}`;

  const endpoint = `https://${shopDomain}.myshopify.com/admin/api/${API_VERSION}/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken,
  };

  if (!overwrite) {
    // === APPEND (merge) ===
    // Shopify will add any missing tags; duplicates are ignored.
    const mutation = `
      mutation AddOrderTags($id: ID!, $tags: [String!]!) {
        tagsAdd(id: $id, tags: $tags) {
          node {
            id
            ... on Order { tags }
          }
          userErrors { field message }
        }
      }
    `;
    const variables = { id: gid, tags: tagsToAdd };

    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: mutation, variables }),
    });
    const json = await resp.json();

    // top-level GraphQL errors
    if (json.errors?.length) {
      throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
    }
    const ue = json?.data?.tagsAdd?.userErrors || [];
    if (ue.length) {
      throw new Error(`Shopify userErrors: ${JSON.stringify(ue)}`);
    }
    const node = json?.data?.tagsAdd?.node || null;
    return node;
  }

  // === OVERWRITE (replace entire tag set) ===
  // orderUpdate takes input: { id, tags }
  const mutation = `
    mutation OrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id tags }
        userErrors { field message }
      }
    }
  `;
  const variables = { input: { id: gid, tags: tagsToAdd } };

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: mutation, variables }),
  });
  const json = await resp.json();

  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  const ue = json?.data?.orderUpdate?.userErrors || [];
  if (ue.length) {
    throw new Error(`Shopify userErrors: ${JSON.stringify(ue)}`);
  }
  return json?.data?.orderUpdate?.order || null;
}

module.exports = { appendOrderTags };
