/**
 * backend/services/searchServicePg.ts
 *
 * PostgreSQL full-text search for transactions.
 * Complements the existing TF-IDF search in searchService.ts.
 * Uses the pre-computed tsvector column + GIN index for performance.
 */

import { pgSequelize } from "../db/postgres.js";
import { QueryTypes } from "sequelize";

export interface PgSearchResult {
  id: string;
  type: "transaction";
  title: string;
  description: string;
  rank: number;
  data: Record<string, unknown>;
  createdAt: Date;
  searchEngine: "postgresql-fts";
}

export async function searchTransactionsFts(
  userId: string,
  query: string,
  options: { limit?: number } = {}
): Promise<PgSearchResult[]> {
  const { limit = 20 } = options;

  // Sanitize query â€” strip non-word chars to prevent tsquery injection
  const sanitized = query
    .trim()
    .replace(/[^\w\s]/g, " ")
    .trim();
  if (!sanitized) return [];

  const rows = await pgSequelize.query<{
    id: string;
    amount: string;
    currency: string;
    transaction_type: string;
    status: string;
    reference_id: string | null;
    created_at: Date;
    sender_account_number: string;
    receiver_account_number: string;
    rank: string;
  }>(
    `SELECT
       t.id,
       t.amount,
       t.currency,
       t.transaction_type,
       t.status,
       t.reference_id,
       t.created_at,
       sa.account_number AS sender_account_number,
       ra.account_number AS receiver_account_number,
       ts_rank(t.search_vector, plainto_tsquery('english', $1)) AS rank
     FROM transactions t
     JOIN accounts sa ON t.sender_account_id = sa.id
     JOIN accounts ra ON t.receiver_account_id = ra.id
     JOIN accounts ua ON (ua.id = t.sender_account_id OR ua.id = t.receiver_account_id)
     WHERE ua.user_id = $2
       AND t.search_vector @@ plainto_tsquery('english', $1)
     ORDER BY rank DESC, t.created_at DESC
     LIMIT $3`,
    { bind: [sanitized, userId, limit], type: QueryTypes.SELECT }
  );

  return rows.map((row) => ({
    id: row.id,
    type: "transaction" as const,
    title: `${row.transaction_type} - ${row.currency} ${row.amount}`,
    description: `Status: ${row.status} | Ref: ${row.reference_id ?? "N/A"}`,
    rank: parseFloat(row.rank),
    data: {
      amount: row.amount,
      currency: row.currency,
      transactionType: row.transaction_type,
      status: row.status,
      referenceId: row.reference_id,
      senderAccountNumber: row.sender_account_number,
      receiverAccountNumber: row.receiver_account_number,
    },
    createdAt: row.created_at,
    searchEngine: "postgresql-fts" as const,
  }));
}
