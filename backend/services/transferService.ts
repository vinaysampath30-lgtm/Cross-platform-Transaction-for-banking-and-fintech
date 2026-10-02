import { QueryTypes } from "sequelize";
import { pgSequelize } from "../db/postgres.js";
import { AccountPg } from "../db/pg-models/AccountPg.js";
import { executeTransferPg } from "./transferServicePg.js";
import type { TransferInput, TransactionQueryInput } from "../validation/schemas.js";

export async function executeTransfer(userId: string, input: TransferInput, meta: { ipAddress?: string; userAgent?: string }) {
  const currency = input.currency || "USD";
  const account = await AccountPg.findOne({ where: { user_id: userId, currency } });
  if (!account) throw new Error(`NO_${currency}_ACCOUNT`);
  return executeTransferPg(userId, { senderAccountId: account.id, receiverAccountNumber: input.receiverAccountNumber, amount: input.amount, currency, transactionType: "internal", referenceId: input.reference, idempotencyKey: input.idempotencyKey, note: input.note }, meta);
}

export async function getTransactionHistory(userId: string, query: TransactionQueryInput) {
  const page = query.page || 1;
  const limit = query.limit || 20;
  const rows = await pgSequelize.query<any>(
    `SELECT t.id, t.amount::text, t.currency, t.transaction_type, t.status, t.reference_id, t.created_at,
       sa.account_number AS sender_account_number, ra.account_number AS receiver_account_number,
       (sa.user_id = $1::uuid) AS outgoing
     FROM transactions t JOIN accounts sa ON sa.id = t.sender_account_id JOIN accounts ra ON ra.id = t.receiver_account_id
     WHERE sa.user_id = $1::uuid OR ra.user_id = $1::uuid
     ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
    { bind: [userId, limit, (page - 1) * limit], type: QueryTypes.SELECT }
  );
  const countRows = await pgSequelize.query<{ count: string }>(
    `SELECT COUNT(DISTINCT t.id)::text AS count FROM transactions t WHERE EXISTS (SELECT 1 FROM accounts a WHERE a.id = t.sender_account_id AND a.user_id = $1::uuid) OR EXISTS (SELECT 1 FROM accounts a WHERE a.id = t.receiver_account_id AND a.user_id = $1::uuid)`,
    { bind: [userId], type: QueryTypes.SELECT }
  );
  return { transactions: rows.map((row) => ({ id: row.id, amount: row.amount, currency: row.currency, type: row.transaction_type, status: row.status, referenceId: row.reference_id, direction: row.outgoing ? "outgoing" : "incoming", counterpartyAccountNumber: row.outgoing ? row.receiver_account_number : row.sender_account_number, createdAt: row.created_at })), total: Number(countRows[0]?.count ?? 0) };
}
