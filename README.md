# Product Discovery Service

An on-demand catalog service that generates product data from the search query,
then returns the stored product collection on future matching searches. It does
not scrape retailers or manufacturer websites.

## Run locally

1. Copy `.env.example` to `.env` and set your Turso credentials for persistence.
2. Load the values into your shell, then run `npm start`:

```sh
set -a; source .env; set +a
npm start
```
3. Search with:

```sh
curl 'http://localhost:3000/api/products/search?q=wireless%20headphones&limit=12'
```

The first request generates normalized items from the query, stores them in
Turso, and returns them. Later requests return the stored collection. Product
prices are explicitly marked as simulated because the data is generated.

Run tests with `npm test`.

## Deploy to Vercel

Vercel uses `src/app.js` as its Node server entrypoint and deploys the functions
in `api/products/`, which delegate to the shared handlers in
`src/product-api.js`. The API is available at `/api/products/search`,
`/api/products/stream`, `/api/products/shelf`, and `/api/products/compare`; no
`vercel.json` file is required. OpenAPI JSON is available at `/openapi.json`,
and the Swagger UI page is at `/docs`.
Add `not-suspicious=Hum^n` to switch the search, stream, shelf, and compare
endpoints to the hidden intergalactic mart catalog.

You can also set `persona=normal`, `persona=luxury`, `persona=bargain`, or
`persona=minimalist` to shift the generated shelf while keeping the same query
intent. The response includes item explanations and provenance so the UI can
show why an item exists and whether it was served from cache.

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

`GET /api/products/shelf?q=wireless%20headphones` streams grouped shelf rows
such as `best-fit`, `cheap-but-decent`, `weirdly-good`, and `backup-option`.
`GET /api/products/compare?q=wireless%20headphones&count=4` returns a side-by-
side verdict for 2 to 4 products.

This is intentionally a product-data stream, not an LLM stream. Add AI SDK when
you introduce model work such as query interpretation, product comparisons, or
grounded recommendations. The generated product data remains the source of
truth for titles, prices, stock, and images.

## Product presentation

Every catalog item includes a deterministic inline SVG `imageUrl`, a `rating`
from 1 to 5 when reviews exist, a `reviewCount` from 0 to 250, and a full
`reviews` array with synthetic review text. These values are calculated from
the search query and cached so they remain unchanged when the same product is
returned again.
