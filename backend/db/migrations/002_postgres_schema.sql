-- =============================================================================
-- NexusPay Banking API - PostgreSQL Schema
-- Migration: 002_postgres_schema.sql
-- =============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username             VARCHAR(30)  NOT NULL,
  first_name           VARCHAR(100) NOT NULL,
  last_name            VARCHAR(100) NOT NULL DEFAULT '',
  email                VARCHAR(320) NOT NULL,
  password_hash        VARCHAR(255) NOT NULL,
  pin_hash             VARCHAR(255) NOT NULL DEFAULT '',
  kyc_status           VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (kyc_status IN ('pending','verified','rejected')),
  mfa_secret           VARCHAR(64),
  mfa_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  reset_token          VARCHAR(64),
  reset_token_expires  BIGINT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_users_email    UNIQUE (email),
  CONSTRAINT uq_users_username UNIQUE (username)
);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- ─── accounts ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  account_number VARCHAR(30)   NOT NULL,
  balance        NUMERIC(19,4) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  currency       CHAR(3)       NOT NULL,
  version_id     INTEGER       NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_accounts_number        UNIQUE (account_number),
  CONSTRAINT uq_accounts_user_currency UNIQUE (user_id, currency)
);
CREATE INDEX IF NOT EXISTS idx_accounts_user_id ON accounts (user_id);

-- ─── transactions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  receiver_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  amount              NUMERIC(19,4) NOT NULL CHECK (amount > 0),
  currency            CHAR(3)       NOT NULL,
  transaction_type    VARCHAR(20)   NOT NULL CHECK (transaction_type IN ('internal','wire','billpay')),
  status              VARCHAR(20)   NOT NULL DEFAULT 'initiated'
                        CHECK (status IN ('initiated','authorized','processing','completed','failed','reversed')),
  reference_id        VARCHAR(128),
  idempotency_key     VARCHAR(128),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_txn_idempotency UNIQUE (sender_account_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_txn_sender    ON transactions (sender_account_id,   created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_receiver  ON transactions (receiver_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_txn_reference ON transactions (reference_id) WHERE reference_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_txn_status    ON transactions (status, created_at DESC);

-- ─── ledger_entries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  UUID NOT NULL REFERENCES transactions(id) ON DELETE RESTRICT,
  account_id      UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  entry_type      VARCHAR(10) NOT NULL CHECK (entry_type IN ('debit','credit')),
  amount          NUMERIC(19,4) NOT NULL,
  balance_after   NUMERIC(19,4) NOT NULL,
  currency        CHAR(3) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ledger_account ON ledger_entries (account_id,    created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_txn     ON ledger_entries (transaction_id);

-- ─── beneficiaries ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS beneficiaries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  account_number VARCHAR(30)  NOT NULL,
  bank_name      VARCHAR(100),
  bank_code      VARCHAR(20),
  currency       CHAR(3)  NOT NULL DEFAULT 'USD',
  nickname       VARCHAR(50),
  is_favorite    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_beneficiaries_user_account UNIQUE (user_id, account_number)
);
CREATE INDEX IF NOT EXISTS idx_beneficiaries_user ON beneficiaries (user_id);

-- ─── sessions (replaces MongoDB DeviceSession) ────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash  VARCHAR(64) NOT NULL,
  device_name         VARCHAR(200),
  ip_address          VARCHAR(45),
  user_agent          TEXT,
  expires_at          TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sessions_token UNIQUE (refresh_token_hash)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token  ON sessions (refresh_token_hash);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ─── outbox_events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS outbox_events (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type     VARCHAR(100) NOT NULL,
  aggregate_id   VARCHAR(128) NOT NULL,
  payload        JSONB NOT NULL DEFAULT '{}',
  processed_at   TIMESTAMPTZ,
  retry_count    INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outbox_unprocessed ON outbox_events (created_at) WHERE processed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outbox_aggregate   ON outbox_events (aggregate_id);

-- ─── otp_challenges ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS otp_challenges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  otp_hash        VARCHAR(64) NOT NULL,
  purpose         VARCHAR(50) NOT NULL CHECK (purpose IN ('transfer','login_mfa','password_reset')),
  context         JSONB,
  expires_at      TIMESTAMPTZ NOT NULL,
  verified_at     TIMESTAMPTZ,
  attempts        INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_otp_user   ON otp_challenges (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_otp_expiry ON otp_challenges (expires_at) WHERE verified_at IS NULL;

-- ─── Full-text search on transactions ─────────────────────────────────────────
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english',
      COALESCE(reference_id, '') || ' ' || transaction_type || ' ' || status || ' ' || currency
    )
  ) STORED;
CREATE INDEX IF NOT EXISTS idx_txn_fts ON transactions USING GIN (search_vector);
