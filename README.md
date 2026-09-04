# Grocery Platform — Backend (Step 1: Foundation + Product Catalog)

This is the backend API for the grocery platform. This first milestone covers
only the **backend foundation and product catalog** (Categories, Brands,
Products). Authentication, carts, orders, payments, and the customer/admin
apps come in later steps.

## Tech stack

- Node.js + TypeScript
- NestJS (modular monolith — one deployable app, cleanly separated modules)
- PostgreSQL
- Prisma ORM
- REST API
- Docker Compose (local Postgres only)

## Prerequisites

- Node.js 20+
- Docker Desktop (for local PostgreSQL)

## Getting started

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment variables**

   ```bash
   cp .env.example .env
   ```

   The defaults in `.env.example` work out of the box with the bundled
   `docker-compose.yml`. Change them if you need different credentials.

3. **Start PostgreSQL**

   ```bash
   docker compose up -d
   ```

   This starts a Postgres 16 container on `localhost:5432` with a named
   Docker volume, so your data survives container restarts.

4. **Run database migrations**

   ```bash
   npx prisma migrate dev
   ```

   This creates the `categories`, `brands`, and `products` tables from
   `prisma/schema.prisma`.

5. **Start the API in watch mode**

   ```bash
   npm run start:dev
   ```

   The API will be available at `http://localhost:3000`.

## Verifying it works

- **Health check:** `curl http://localhost:3000/health` → `{"success":true,"data":{"status":"ok", ...}}`
- **Unit tests:** `npm test`
- **Prisma Studio** (a GUI to browse your database): `npm run prisma:studio`

## API overview

All successful responses are wrapped as `{ "success": true, "data": ... }`.
All errors are wrapped as `{ "success": false, "statusCode", "error", "message", "path", "timestamp" }`.

### Categories

| Method | Path             | Notes                     |
| ------ | ---------------- | ------------------------- |
| GET    | /categories      | List all categories       |
| GET    | /categories/:id  | Get one category          |
| POST   | /categories      | Create (slug auto-generated from name if omitted) |
| PATCH  | /categories/:id  | Partial update            |
| DELETE | /categories/:id  | Delete (fails if products still reference it) |

### Brands

Same shape as Categories, at `/brands`.

### Products

| Method | Path          | Notes |
| ------ | ------------- | ----- |
| GET    | /products     | List with pagination, search, filtering, sorting (see below) |
| GET    | /products/:id | Get one product, with brand and category included |
| POST   | /products     | Create |
| PATCH  | /products/:id | Partial update |
| DELETE | /products/:id | Delete |

`GET /products` query parameters:

- `page` (default 1), `limit` (default 20, max 100)
- `search` — case-insensitive partial match on product name
- `categoryId`, `brandId` — exact match filters
- `sortBy` — one of `name`, `sellingPrice`, `createdAt` (default `createdAt`)
- `sortOrder` — `asc` or `desc` (default `desc`)

Example: `GET /products?search=milk&categoryId=cat_123&sortBy=sellingPrice&sortOrder=asc&page=1&limit=20`

Response shape:

```json
{
  "success": true,
  "data": {
    "items": [ /* products */ ],
    "meta": { "total": 137, "page": 1, "limit": 20, "totalPages": 7 }
  }
}
```

## Database design notes

- **Money** (`mrp`, `sellingPrice`) uses Postgres `DECIMAL(10,2)`, never
  floating point, to avoid rounding errors.
- **`sku`** and **`slug`** are unique per product; `slug` is also unique per
  category and per brand.
- Indexes exist on `categoryId`, `brandId`, `isActive`, `name`, and
  `sellingPrice` on the `products` table — these are the fields the API
  filters and sorts on, and matter once the catalog grows past thousands of
  rows.
- A product's `sellingPrice` can never exceed its `mrp` — enforced in
  `ProductsService`.

## Project structure

```
backend/
├── src/
│   ├── categories/       # Category CRUD (controller, service, DTOs)
│   ├── brands/            # Brand CRUD
│   ├── products/          # Product CRUD + list with pagination/search/sort
│   ├── database/          # PrismaService (the DB connection) as a global module
│   ├── common/
│   │   ├── dto/            # Shared pagination DTO/types
│   │   ├── filters/        # Global HTTP exception filter (consistent error shape)
│   │   ├── interceptors/   # Global response transformer (consistent success shape)
│   │   └── utils/          # slugify + Prisma error translation helpers
│   ├── app.module.ts
│   ├── app.controller.ts  # /health endpoint
│   └── main.ts
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── docker-compose.yml
├── .env.example
└── package.json
```

## What's intentionally NOT in Step 1

Authentication, cart, orders, payments, delivery, notifications, the Android
app, the web app, and the admin panel. These come in later steps, once the
catalog foundation is verified to work correctly.
