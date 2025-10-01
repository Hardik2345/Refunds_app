const fetch = require('node-fetch');

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2024-07';

/**
 * Append tags to a Shopify order using Admin GraphQL API.
 * - Accepts either a numeric order id (e.g., 123456789) or a full gid
 * - Merges with existing tags by fetching them first, unless overwrite=true
 */
async function appendOrderTags({ shopDomain, accessToken, orderId, tagsToAdd = [], overwrite = false }) {
  if (!shopDomain || !accessToken || !orderId || !Array.isArray(tagsToAdd)) {
    throw new Error('appendOrderTags: missing required params');
  }
  const gid = String(orderId).startsWith('gid://')
    ? String(orderId)
    : `gid://shopify/Order/${orderId}`;

  const endpoint = `https://${shopDomain}.myshopify.com/admin/api/${API_VERSION}/graphql.json`;
  const headers = {
    'Content-Type': 'application/json',
    'X-Shopify-Access-Token': accessToken,
  };

  // If not overwriting, fetch current tags and merge
  let nextTags = tagsToAdd;
  if (!overwrite) {
    const getQuery = `query getOrder($id: ID!) { order(id: $id) { id tags } }`;
    const getRes = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: getQuery, variables: { id: gid } })
    });
    const getJson = await getRes.json();
    const currentTags = getJson?.data?.order?.tags || [];
    const set = new Set([...(currentTags || []), ...tagsToAdd]);
    nextTags = Array.from(set);
  }

  const mutation = `
    mutation orderUpdate($id: ID!, $input: OrderInput!) {
      orderUpdate(id: $id, input: $input) {
        order { id tags }
        userErrors { field message }
      }
    }
  `;
  const variables = { id: gid, input: { tags: nextTags } };

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: mutation, variables })
  });
  const json = await resp.json();

  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  const userErrors = json?.data?.orderUpdate?.userErrors || [];
  if (userErrors.length) {
    throw new Error(`Shopify userErrors: ${JSON.stringify(userErrors)}`);
  }
  return json?.data?.orderUpdate?.order || null;
}

module.exports = { appendOrderTags };