/**
 * backend/services/transferServicePg.ts
 *
 * PostgreSQL-based transfer service.
 * Implements:
 *   - Idempotency (unique key per sender+idempotency_key)
 *   - Immutable ledger entries (debit + credit)
 *   - Outbox events (atomic with transfer)
 *   - Transaction states: initiated â†’ processing â†’ completed/failed
 *   - Optimistic locking via version_id
 *   - Deterministic lock ordering (lower UUID first) to prevent deadlocks
 */

import { QueryTypes } from "sequelize";
import { pgSequelize } from "../db/postgres.js";
import { AccountPg } from "../db/pg-models/AccountPg.js";
import { TransactionPg } from "../db/pg-models/TransactionPg.js";
import Decimal from "decimal.js";
import { randomUUID } from "crypto";

export interface TransferInputPg {
  senderAccountId: string;
  receiverAccountNumber: string;
  amount: string;
  currency: string;
  transactionType: "internal" | "wire" | "billpay";
  referenceId?: string;
  idempotencyKey?: string;
  note?: string;
}

export interface TransferResultPg {
  transactionId: string;
  status: string;
  amount: string;
  currency: string;
  senderNewBalance: string;
  receiverNewBalance: string;
  referenceId: string;
  createdAt: Date;
  idempotent: boolean; // true if this was a duplicate request
}

export class InsufficientFundsError extends Error {
  constructor() {
    super("INSUFFICIENT_FUNDS");
    this.name = "InsufficientFundsError";
  }
}

export class IdempotentDuplicateError extends Error {
  public readonly existingTxId: string;
  constructor(txId: string) {
    super("IDEMPOTENT_DUPLICATE");
    this.name = "IdempotentDuplicateError";
    this.existingTxId = txId;
  }
}

export class SelfTransferError extends Error {
  constructor() {
    super("SELF_TRANSFER");
    this.name = "SelfTransferError";
  }
}

export class AccountNotFoundError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AccountNotFoundError";
  }
}

export class CurrencyMismatchError extends Error {
  constructor() {
    super("CURRENCY_MISMATCH");
    this.name = "CurrencyMismatchError";
  }
}

function generateReferenceId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `TXN-${ts}-${rand}`;
}

export async function executeTransferPg(
  senderUserId: string,
  input: TransferInputPg,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<TransferResultPg> {
  const {
    senderAccountId,
    receiverAccountNumber,
    amount,
    currency,
    transactionType,
    referenceId,
    idempotencyKey,
    note,
  } = input;

  const amountDecimal = new Decimal(amount);
  if (amountDecimal.lte(0)) throw new Error("INVALID_AMOUNT");
  if (amountDecimal.gt("999999999.9999")) throw new Error("AMOUNT_TOO_LARGE");

  // Find sender account (verify ownership)
  const senderAccount = await AccountPg.findOne({
    where: { id: senderAccountId, user_id: senderUserId, currency },
  });
  if (!senderAccount) throw new AccountNotFoundError(`NO_${currency}_ACCOUNT`);

  // Find receiver account
  const receiverAccount = await AccountPg.findOne({
    where: { account_number: receiverAccountNumber.trim() },
  });
  if (!receiverAccount) throw new AccountNotFoundError("RECEIVER_NOT_FOUND");

  // Self-transfer check
  if (senderAccount.id === receiverAccount.id) throw new SelfTransferError();

  // Currency check
  if (receiverAccount.currency !== currency) throw new CurrencyMismatchError();

  // Idempotency check (before opening transaction)
  if (idempotencyKey) {
    const existing = await TransactionPg.findOne({
      where: { sender_account_id: senderAccountId, idempotency_key: idempotencyKey },
    });
    if (existing && (existing.status === "completed" || existing.status === "processing")) {
      const senderBal = await AccountPg.findByPk(senderAccountId);
      const receiverBal = await AccountPg.findByPk(receiverAccount.id);
      return {
        transactionId: existing.id,
        status: existing.status,
        amount: existing.amount,
        currency: existing.currency,
        senderNewBalance: senderBal?.balance ?? "0",
        receiverNewBalance: receiverBal?.balance ?? "0",
        referenceId: existing.reference_id ?? "",
        createdAt: existing.created_at!,
        idempotent: true,
      };
    }
  }

  const txnId = randomUUID();
  const refId = referenceId || generateReferenceId();

  // Determine lock order: always lock lower UUID first to prevent deadlocks
  const [firstId, secondId] =
    senderAccountId < receiverAccount.id
      ? [senderAccountId, receiverAccount.id]
      : [receiverAccount.id, senderAccountId];

  const result = await pgSequelize.transaction(async (t) => {
    // 1. Create transaction record with 'initiated' status
    await pgSequelize.query(
      `INSERT INTO transactions (id, sender_account_id, receiver_account_id, amount, currency,
        transaction_type, status, reference_id, idempotency_key, created_at)
       VALUES ($1, $2, $3, $4::NUMERIC, $5, $6, 'initiated', $7, $8, NOW())`,
      {
        bind: [
          txnId,
          senderAccountId,
          receiverAccount.id,
          amount,
          currency,
          transactionType,
          refId,
          idempotencyKey ?? null,
        ],
        transaction: t,
      }
    );

    // 2. Lock both accounts in deterministic order
    const lockedRows = await pgSequelize.query<{
      id: string;
      balance: string;
      version_id: number;
      user_id: string;
    }>(
      `SELECT id, balance, version_id, user_id FROM accounts
       WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      { bind: [[firstId, secondId]], transaction: t, type: QueryTypes.SELECT }
    );

    const lockedSender = lockedRows.find((r) => r.id === senderAccountId);
    const lockedReceiver = lockedRows.find((r) => r.id === receiverAccount.id);

    if (!lockedSender)
      throw new AccountNotFoundError("SENDER_ACCOUNT_LOCKED_NOT_FOUND");
    if (!lockedReceiver)
      throw new AccountNotFoundError("RECEIVER_ACCOUNT_LOCKED_NOT_FOUND");

    // 3. Re-check balance after acquiring lock
    const freshBalance = new Decimal(lockedSender.balance);
    if (freshBalance.lt(amountDecimal)) {
      await pgSequelize.query(
        `UPDATE transactions SET status = 'failed' WHERE id = $1`,
        { bind: [txnId], transaction: t }
      );
      throw new InsufficientFundsError();
    }

    // 4. Update transaction to 'processing'
    await pgSequelize.query(
      `UPDATE transactions SET status = 'processing' WHERE id = $1`,
      { bind: [txnId], transaction: t }
    );

    // 5. Debit sender (with optimistic lock check via version_id)
    const debitResult = await pgSequelize.query(
      `UPDATE accounts
       SET balance = balance - $1::NUMERIC, version_id = version_id + 1, updated_at = NOW()
       WHERE id = $2 AND version_id = $3`,
      { bind: [amount, senderAccountId, lockedSender.version_id], transaction: t }
    );

    // pg driver returns [results, rowCount]
    const debitAffected = (debitResult as [unknown, number])[1];
    if (!debitAffected || debitAffected === 0) {
      throw new Error("OPTIMISTIC_LOCK_FAILED_SENDER");
    }

    // 6. Credit receiver
    await pgSequelize.query(
      `UPDATE accounts
       SET balance = balance + $1::NUMERIC, version_id = version_id + 1, updated_at = NOW()
       WHERE id = $2`,
      { bind: [amount, receiverAccount.id], transaction: t }
    );

    // 7. Get new balances
    const newBalanceRows = await pgSequelize.query<{ id: string; balance: string }>(
      `SELECT id, balance FROM accounts WHERE id = ANY($1::uuid[])`,
      {
        bind: [[senderAccountId, receiverAccount.id]],
        transaction: t,
        type: QueryTypes.SELECT,
      }
    );

    const newSenderBal =
      newBalanceRows.find((r) => r.id === senderAccountId)?.balance ?? "0";
    const newReceiverBal =
      newBalanceRows.find((r) => r.id === receiverAccount.id)?.balance ?? "0";

    // 8. Create paired ledger entries
    await pgSequelize.query(
      `INSERT INTO ledger_entries
         (id, transaction_id, account_id, entry_type, amount, balance_after, currency, created_at)
       VALUES
         ($1, $2, $3, 'debit',  $4::NUMERIC * -1, $5::NUMERIC, $6, NOW()),
         ($7, $2, $8, 'credit', $9::NUMERIC,       $10::NUMERIC, $6, NOW())`,
      {
        bind: [
          randomUUID(),
          txnId,
          senderAccountId,
          amount,
          newSenderBal,
          currency,
          randomUUID(),
          receiverAccount.id,
          amount,
          newReceiverBal,
        ],
        transaction: t,
      }
    );

    // 9. Mark transaction completed
    await pgSequelize.query(
      `UPDATE transactions SET status = 'completed' WHERE id = $1`,
      { bind: [txnId], transaction: t }
    );

    // 10. Create outbox event (atomic with the same DB transaction)
    await pgSequelize.query(
      `INSERT INTO outbox_events (id, event_type, aggregate_id, payload, created_at)
       VALUES ($1, 'transfer.completed', $2, $3::JSONB, NOW())`,
      {
        bind: [
          randomUUID(),
          txnId,
          JSON.stringify({
            transactionId: txnId,
            senderAccountId,
            receiverAccountId: receiverAccount.id,
            senderUserId,
            receiverUserId: lockedReceiver.user_id,
            amount,
            currency,
            referenceId: refId,
            note: note ?? null,
            ipAddress: meta.ipAddress ?? null,
            userAgent: meta.userAgent ?? null,
          }),
        ],
        transaction: t,
      }
    );

    return { newSenderBal, newReceiverBal };
  });

  return {
    transactionId: txnId,
    status: "completed",
    amount,
    currency,
    senderNewBalance: result.newSenderBal,
    receiverNewBalance: result.newReceiverBal,
    referenceId: refId,
    createdAt: new Date(),
    idempotent: false,
  };
}
