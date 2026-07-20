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

## Users and authentication

User accounts and sessions use the same Turso database as the catalog. The
tables are created automatically on the first user request. Passwords are
stored as salted PBKDF2-SHA-512 hashes; session tokens are stored only as
SHA-256 hashes.

Create an account (passwords must be at least 8 characters):

```sh
curl -X POST http://localhost:3000/api/users/register \
  -H 'content-type: application/json' \
  -d '{"email":"ada@example.com","password":"correct-horse-battery-staple","displayName":"Ada"}'
```

Sign in with `POST /api/users/login` and use the returned token in an
`Authorization: Bearer <token>` header. `GET /api/users/me` returns the signed
in user and their discovery profile, and `POST /api/users/logout` invalidates
that session token.

Update the profile with `PUT /api/users/me`. A profile can save `persona`
(`normal`, `luxury`, `bargain`, or `minimalist`), `budgetMin`, `budgetMax`, and
up to 20 `preferredCategories` or `excludedCategories`. Authenticated product
searches apply those preferences automatically; an explicit `persona` query
parameter overrides the profile persona.

## Deploy to Vercel

Vercel uses `src/app.js` as its Node server entrypoint and deploys the functions
in `api/products/` and `api/users/`, which delegate to the shared handlers in
`src/product-api.js`. The API is available at `/api/products/search`,
`/api/products/stream`, `/api/products/shelf`, `/api/products/compare`,
`/api/products/selling-fast`, `/api/products/featured`,
`/api/cart`, `/api/wallet`, `/api/wallet/topup`, `/api/wallet/transactions`,
`/api/checkout`, `/api/orders`, `/api/orders/:orderId`, `/api/orders/:orderId/status`,
`/api/users/register`, `/api/users/login`, `/api/users/me`, and
`/api/users/logout`; no `vercel.json` file is required. OpenAPI JSON is
available at `/openapi.json`, and the Swagger UI page is at `/docs`.
Add `not-suspicious=Hum^n` to switch the search, stream, shelf, and compare
endpoints to the hidden intergalactic mart catalog.

You can also set `persona=normal`, `persona=luxury`, `persona=bargain`, or
`persona=minimalist` to shift the generated shelf while keeping the same query
intent. The response includes item explanations and provenance so the UI can
show why an item exists and whether it was served from cache.

`GET /api/products/selling-fast` and `GET /api/products/featured` now work
without `q`; they fall back to a default curated shelf when omitted.
Their ordering uses a deterministic UTC-day market simulation (inventory,
demand, sales velocity, and trend) rather than review counts, so both shelves
share a consistent in-world economy. New daily snapshots begin as `seeded`;
successful checkouts persist inventory depletion and sales activity, and mark
the affected product as `observed`. If fewer curated products remain in stock,
the API returns the available items instead of promoting sold-out products.
The separate `/economy` page shows the same market data in a richer dashboard
layout, so it is a good place for demos and screenshots.

## Economy Simulator

The market layer is deterministic per product and per UTC day. For each item we
derive a daily market snapshot from the product ID, the current day, its rating,
and its price. That snapshot produces inventory, units sold, demand score,
sales velocity, featured score, and a trend value. The same product will keep
the same market state for the rest of the day, which makes the demo stable while
still feeling alive.

When a product is first seen on a day, its snapshot is stored as `seeded`.
If a checkout touches that product, the inventory and sales counts are written
back to the market table and the snapshot flips to `observed`, so featured and
selling-fast shelves start to reflect actual in-app purchasing behavior. This
means the catalog is fake, but the economy reacts like a real store.

Checkout is auth-only. Add funds with `POST /api/wallet/topup`, add items with
`POST /api/cart/items`, then `POST /api/checkout` to create an order. Order
status and ETA are available from `/api/orders/:orderId/status`.

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
