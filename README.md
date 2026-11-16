# Challenge Backend

REST API built with Node.js, Express, TypeScript and PostgreSQL. It exposes a user's portfolio, an asset search, and order management (submit, list and cancel).

## Tech stack

- **Node.js 22** and **TypeScript**, run in development with `tsx`
- **Express 5**
- **PostgreSQL** accessed directly through `pg` (no ORM), with SQL isolated in repositories
- **Zod** for request validation (params, query and body)
- **Vitest** and **Supertest** for functional tests

## Getting started

### Prerequisites

- Node.js 22 or later
- PostgreSQL running locally

### 1. Install dependencies

```bash
npm install
```

### 2. Create and populate the database

```bash
createdb challenge
psql challenge -f database.sql
```

### 3. Configure the environment

Create a `.env` file in the project root (see `.env.example`):

```
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/challenge
PORT=3000
```

### 4. Run the server

```bash
npm run dev
```

The API is served at `http://localhost:3000/api`.

### Scripts

| Script | Description |
|---|---|
| `npm run dev` | Starts the server with auto-reload (`tsx watch`) |
| `npm test` | Runs the functional tests against the test database |
| `npm run build` | Compiles TypeScript to `dist/` |

## Running the tests

The tests drop and recreate the schema, so they **must** use a separate database.

```bash
createdb challenge_test
```

Create a `.env.test` file:

```
DATABASE_URL=postgresql://YOUR_USER@localhost:5432/challenge_test
```

Make sure `database.sql` is in the project root, then:

```bash
npm test
```

Safety guard: the global setup refuses to run unless the database name ends in `_test`. Before each test, orders created by previous tests are removed, so only the original seed data remains.

## Project structure

```
src/
├── app.ts              Express app (no listen, so tests can import it)
├── server.ts           Entry point: connects and listens
├── db.ts               pg connection pool
├── routes/
│   └── router.ts       URL map
├── controllers/        HTTP layer: reads the request, calls repositories, responds
├── repositories/       All SQL lives here
├── schemas/            Zod schemas for params, query and body
└── middlewares/
    └── validate.ts     Validates input with Zod and stores the result in res.locals
tests/                  Vitest + Supertest functional tests
```

Request flow: **route → validate middleware → controller → repository → database**.

## Endpoints

Base URL: `http://localhost:3000/api`

| Method | Path | Description |
|---|---|---|
| GET | `/assets` | Search instruments by ticker and/or name |
| GET | `/users` | List users |
| GET | `/users/:id` | Get a user by id |
| GET | `/users/:id/portfolio` | Account value, available cash and positions |
| GET | `/users/:id/orders` | List a user's orders |
| POST | `/users/:id/orders` | Submit an order |
| DELETE | `/users/:id/orders/:orderId` | Cancel a `NEW` order |

A ready-to-run collection with examples (including error cases) is in `requests.http`.

### GET `/assets`

Optional query parameters `ticker` and `name`. Both are case-insensitive partial matches. When both are sent, an instrument must match both.

```bash
curl "http://localhost:3000/api/assets?ticker=ga"
curl "http://localhost:3000/api/assets?ticker=b&name=banco"
```

```json
[
  { "id": 11, "ticker": "GAMI", "name": "Boldt Gaming S.A.", "type": "ACCIONES" }
]
```

Repeating a parameter (`?ticker=a&ticker=b`) returns `400`.

### GET `/users/:id/portfolio`

```json
{
  "userId": 1,
  "totalAccountValue": 904784,
  "availableCash": 753000,
  "instruments": [
    {
      "instrumentId": 47,
      "ticker": "YPFD",
      "name": "Y.P.F. S.A.",
      "quantity": 40,
      "lastPrice": 925.85,
      "totalValue": 37034,
      "dailyReturnPct": 0.44,
      "totalReturnPct": -0.45
    }
  ]
}
```

The values above are illustrative; the real numbers depend on the data in the database.

- `totalAccountValue` = available cash + total value of all positions.
- `dailyReturnPct` = (`close` − `previousClose`) / `previousClose` × 100, from the latest `marketdata` row. It is `null` when there is no quote or no valid `previousClose`.
- `totalReturnPct` = (current price − average purchase price) / average purchase price × 100.

### POST `/users/:id/orders`

There are three accepted body shapes.

**MARKET order** (BUY or SELL). Send either `size` (number of shares) or `amount` (total in pesos), never both:

```json
{ "instrumentId": 47, "side": "BUY", "type": "MARKET", "size": 10 }
```

```json
{ "instrumentId": 47, "side": "BUY", "type": "MARKET", "amount": 10000 }
```

**LIMIT order** (BUY or SELL). `price` is required, and `size` or `amount` (exactly one):

```json
{ "instrumentId": 47, "side": "BUY", "type": "LIMIT", "size": 10, "price": 900 }
```

**Cash movement** (CASH_IN or CASH_OUT) on the `MONEDA` instrument. `size` is the amount in pesos:

```json
{ "instrumentId": 66, "side": "CASH_IN", "type": "MARKET", "size": 100000 }
```

Response (`201 Created`):

```json
{
  "id": 12,
  "instrumentId": 47,
  "userId": 2,
  "size": 10,
  "price": 925.85,
  "type": "MARKET",
  "side": "BUY",
  "status": "FILLED",
  "datetime": "2026-11-16T12:00:00.000Z"
}
```

Rejected orders (insufficient funds or shares) are stored and also return `201`, with `"status": "REJECTED"`.

### DELETE `/users/:id/orders/:orderId`

Changes an order from `NEW` to `CANCELLED` and returns the updated order.

| Status | Meaning |
|---|---|
| 200 | Order cancelled |
| 400 | Invalid `id` or `orderId` |
| 404 | Order not found, or it belongs to another user |
| 409 | Order is not in `NEW` status |

### Error format

Validation errors return `400` with the Zod issues:

```json
{ "error": "Invalid body", "details": [ { "path": ["size"], "message": "..." } ] }
```

Other errors use `{ "error": "message" }` with `404`, `409` or `500`.

## Assumptions and design decisions

### Orders and statuses

- **MARKET** orders are executed immediately, are stored as `FILLED`, and use the latest `close` from `marketdata`. A `price` sent with a MARKET order is ignored.
- **LIMIT** orders are stored as `NEW` with the price provided. The market is not simulated, so a LIMIT order is never filled later.
- **Rejections are stored.** A BUY without enough pesos, a SELL without enough shares, an order for an instrument with no quote, or an `amount` too small for one share is saved with status `REJECTED`. The endpoint still answers `201`, because the order was created.
- **Only `NEW` orders can be cancelled.** The check and the update happen in a single `UPDATE ... WHERE status = 'NEW'`, so concurrent requests cannot cancel an order twice. Orders are never deleted, so history is kept.
- **LIMIT orders do not reserve cash.** Balance and share checks use the state at submission time.

### Order by amount

- `amount` is a total in pesos. The API computes `size = floor(amount / price)`; fractional shares are not allowed.
- The price is the latest `close` for MARKET orders and the informed `price` for LIMIT orders. The calculation is done in cents to avoid floating-point errors.
- If the computed `size` is 0, the order is stored as `REJECTED` with `size = 0`.

### Cash movements

- `CASH_IN` and `CASH_OUT` are only valid for instruments of type `MONEDA`, and `BUY`/`SELL` are not allowed on `MONEDA`. This check depends on the database, so it lives in the controller rather than in the Zod schema.
- They are stored with `type = 'MARKET'` and `price = 1`, matching the seed data, so `size` is the amount in pesos.
- `CASH_IN` is always `FILLED`. `CASH_OUT` is `FILLED` if the balance covers it; otherwise it is `REJECTED`, so the balance never goes negative.

### Balance and positions

- No positions table exists. Cash and positions are **derived from `orders` with status `FILLED`**, using the `size` column. Every executed order is therefore reflected immediately, with no separate update step.
- Cash = `CASH_IN` + `SELL` − `CASH_OUT` − `BUY` (each as `size × price`).
- Position quantity = `BUY` − `SELL` per instrument. Only positions greater than zero are listed.
- Instrument prices are in pesos, as in the source data.

### Concurrency

Order creation runs inside a transaction that first takes a per-user advisory lock (`pg_advisory_xact_lock`). Two simultaneous orders from the same user are serialized, so both cannot pass the balance check at the same time. There is a test for this case.

### Validation

- Input shape is validated with Zod in a reusable middleware; the validated data is stored in `res.locals` (in Express 5, `req.query` is read-only).
- Ids are limited to the Postgres `INT` range, so oversized ids return `400` instead of a database error.
- Rules that need the database (user exists, instrument exists, instrument type) stay in the controller.

### Database

- No changes were made to the provided schema or data.
- Column names are camelCase in the SQL script but unquoted, so Postgres stores them in lowercase. Queries use aliases (for example `accountnumber AS "accountNumber"`) to return camelCase JSON.
- `NUMERIC` and `BIGINT` values are cast to `float8` / `int` in SQL because `pg` returns them as strings.

### Authentication

Not implemented, as allowed by the challenge. The `:id` in the URL identifies the user, and the code verifies that an order belongs to that user, but nothing verifies who is calling the API. A real deployment would need authentication and an authorization check comparing the authenticated user with `:id`.

## Known limitations

- Returns are simplified: `totalReturnPct` uses the average purchase price and ignores profit already realized by sales.
- LIMIT orders stay `NEW` indefinitely; there is no matching engine.
- No pagination on `GET /users/:id/orders`.
- Money is calculated with floating-point numbers, which is enough for these magnitudes. A production system would calculate in `NUMERIC` inside the database.
