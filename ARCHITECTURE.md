# NexusPay Backend Architecture

## Data ownership

| Store | Data |
| --- | --- |
| PostgreSQL 16 | Users, accounts, beneficiaries, transactions, ledger entries, sessions, OTP challenges, and outbox events |
| MongoDB 7 | Notifications and activity logs |

PostgreSQL is the financial source of truth. A transfer uses one PostgreSQL transaction to lock both accounts, update balances, add debit and credit ledger rows, complete the transaction record, and queue an outbox event. Mongo documents refer to PostgreSQL users by UUID string.

## Startup and migrations

`backend/index.ts` validates configuration, connects to PostgreSQL and MongoDB, and then serves the API. PostgreSQL applies `backend/db/migrations/002_postgres_schema.sql` once and records it in `schema_migrations`. MongoDB schemas are defined under `backend/db/mongo-models`.

The normal API paths use PostgreSQL-backed authentication, account and beneficiary services, transfers, and full-text transaction search. Mongo-backed APIs provide notifications and activity logging. `/api/health` reports both database connection states.

## Local development

Copy `.env.example` to `.env`, configure the PostgreSQL and token secrets, then start the databases with:

```sh
docker compose -f docker-compose.dev.yml up -d
```

Install packages and start the client and API with:

```sh
pnpm install
pnpm dev
```

The API listens on port 3001 in development, and the Vite client uses port 3000. See [README.md](README.md) for production Docker instructions.

