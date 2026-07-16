# Product Discovery Service

An on-demand catalog service that seeds real-world product facts from Wikidata,
then returns the stored product collection on future matching searches. It does
not scrape retailers or manufacturer websites.

## Run locally

1. Copy `.env.example` to `.env` and set your Turso credentials for persistence.
2. Load the values into your shell, then run `npm start`.
3. Search with:

```sh
curl 'http://localhost:3000/v1/products/search?q=wireless%20headphones&limit=12'
```

The first request searches Wikidata, stores normalized items in Turso, and
returns them. Later requests return the stored collection. Product prices are
explicitly marked as simulated because Wikidata does not provide live offers.

Run tests with `npm test`.

## Deploy to Vercel

Vercel automatically deploys JavaScript files under `api/` as Node.js Functions.
This project exposes its API at `/api/products/search` and
`/api/products/stream`; no `vercel.json` file is required.

1. Import this repository into Vercel or run `npx vercel` from the project root.
2. Add `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` in Vercel Project Settings.
3. Deploy. Example: `/api/products/search?q=wireless%20headphones`.

Turso is the durable catalog store, so Vercel function instances do not need to
share in-memory state.

## Streaming discovery

`GET /api/products/stream?q=wireless%20headphones` responds as a Server-Sent
Event stream. It sends a `status` event, one `product` event for each normalized
listing, then a terminal `done` event. This lets the UI add product cards as
they arrive rather than waiting to render the complete response.

This is intentionally a product-data stream, not an LLM stream. Add AI SDK when
you introduce model work such as query interpretation, product comparisons, or
grounded recommendations. The provider results remain the source of truth for
titles, prices, stock, and images.
