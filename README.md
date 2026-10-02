# NexusPay Banking

This project uses PostgreSQL for users, accounts, beneficiaries, transfers, ledger entries, sessions, OTP challenges, and transaction search. MongoDB stores notifications and activity logs.

## Run locally

1. Install Node.js 20 or newer, pnpm, and Docker Desktop.
2. Copy `.env.example` to `.env`. Set `PG_PASSWORD` and replace the development JWT and cookie secrets with random values at least 32 characters long.
3. Start the database services with `docker compose -f docker-compose.dev.yml up -d`.
4. From this directory, install packages with `pnpm install`, then run `pnpm dev`.
5. Open the Vite URL shown in the terminal. The API runs at `http://localhost:3001`; its docs are at `/api/docs` and health status at `/api/health`.

The API applies `backend/db/migrations/002_postgres_schema.sql` automatically at startup. Create an account through the app's registration page; previous SQLite/MySQL accounts are not imported.

The login and registration screens use the API. Banking information shown on the dashboard is currently example UI data; the account, transfer, beneficiary, notification, and search APIs are available but are not yet connected to the dashboard.

## Run with Docker

Set secure values for `PG_PASSWORD`, `JWT_SECRET`, `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, and `COOKIE_SECRET` in `.env`, then run `docker compose up -d --build`. The web app and API are served on port 3000, PostgreSQL on 5432, and MongoDB on 27017. `docker compose down` stops the services while preserving database volumes.

## Database responsibilities

- **PostgreSQL** is the source of truth for all financial and identity records. Transfers update both account balances and write matching ledger rows in one database transaction.
- **MongoDB** stores flexible activity and notification documents keyed by PostgreSQL user UUIDs.
- **SQLite and MySQL are not part of the active application or Docker setup.** Existing local database files are not migrated or used.
