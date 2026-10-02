/**
 * backend/services/outboxWorker.ts
 *
 * Background worker that processes outbox_events.
 * Reads unprocessed events â†’ publishes to MongoDB notifications/activity logs
 * â†’ marks as processed. Retryable and idempotent.
 */

import { QueryTypes } from "sequelize";
import { pgSequelize } from "../db/postgres.js";
import { Notification } from "../db/mongo-models/Notification.js";
import { ActivityLog } from "../db/mongo-models/ActivityLog.js";

interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  retry_count: number;
  created_at: Date;
}

const MAX_RETRIES = 5;
const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 20;

let workerTimer: NodeJS.Timeout | null = null;
let running = false;

export function startOutboxWorker(): void {
  if (running) return;
  running = true;
  console.log("[outbox] Worker started");
  scheduleNextRun();
}

export function stopOutboxWorker(): void {
  running = false;
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
  console.log("[outbox] Worker stopped");
}

function scheduleNextRun(): void {
  if (!running) return;
  workerTimer = setTimeout(async () => {
    try {
      await processOutboxBatch();
    } catch (err) {
      console.error("[outbox] Batch error:", err);
    }
    scheduleNextRun();
  }, POLL_INTERVAL_MS);
}

async function processOutboxBatch(): Promise<void> {
  // Pessimistic lock with SKIP LOCKED allows multiple workers to run concurrently
  const events = await pgSequelize.query<OutboxRow>(
    `SELECT id, event_type, aggregate_id, payload, retry_count, created_at
     FROM outbox_events
     WHERE processed_at IS NULL AND retry_count < $1
     ORDER BY created_at ASC
     LIMIT $2
     FOR UPDATE SKIP LOCKED`,
    { bind: [MAX_RETRIES, BATCH_SIZE], type: QueryTypes.SELECT }
  );

  for (const event of events) {
    await processEvent(event);
  }
}

async function processEvent(event: OutboxRow): Promise<void> {
  try {
    switch (event.event_type) {
      case "transfer.completed":
        await handleTransferCompleted(event);
        break;
      case "transfer.failed":
        await handleTransferFailed(event);
        break;
      default:
        console.warn(`[outbox] Unknown event type: ${event.event_type}`);
    }

    // Mark as processed
    await pgSequelize.query(
      `UPDATE outbox_events SET processed_at = NOW() WHERE id = $1`,
      { bind: [event.id] }
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(
      `[outbox] Event ${event.id} failed (attempt ${event.retry_count + 1}):`,
      errMsg
    );

    await pgSequelize.query(
      `UPDATE outbox_events SET retry_count = retry_count + 1, error = $1 WHERE id = $2`,
      { bind: [errMsg.slice(0, 1000), event.id] }
    );
  }
}

async function handleTransferCompleted(event: OutboxRow): Promise<void> {
  const payload = event.payload as Record<string, unknown>;
  const {
    senderUserId,
    receiverUserId,
    amount,
    currency,
    referenceId,
    transactionId,
    note,
  } = payload;

  // Idempotent: skip if activity log already exists for this transaction
  const existingLog = await ActivityLog.findOne({
    "metadata.transactionId": transactionId,
    eventType: "transfer.completed",
    userId: senderUserId as string,
  } as Record<string, unknown>);

  if (!existingLog) {
    await Promise.all([
      ActivityLog.create({
        userId: senderUserId as string,
        eventType: "transfer.completed",
        category: "transaction",
        metadata: {
          transactionId,
          amount,
          currency,
          referenceId,
          note: note ?? null,
          direction: "outgoing",
        },
        ipAddress: payload.ipAddress as string | undefined,
        userAgent: payload.userAgent as string | undefined,
      }),
      ActivityLog.create({
        userId: receiverUserId as string,
        eventType: "transfer.completed",
        category: "transaction",
        metadata: {
          transactionId,
          amount,
          currency,
          referenceId,
          direction: "incoming",
        },
      }),
      Notification.create({
        userId: receiverUserId as string,
        type: "transaction",
        priority: "normal",
        title: "Funds Received",
        message: `You received ${currency} ${amount}. Ref: ${referenceId}`,
        data: { transactionId, amount, currency, referenceId },
        read: false,
        archived: false,
      }),
    ]);
  }
}

async function handleTransferFailed(event: OutboxRow): Promise<void> {
  const { senderUserId, amount, currency, reason } = event.payload as Record<
    string,
    unknown
  >;
  await ActivityLog.create({
    userId: senderUserId as string,
    eventType: "transfer.failed",
    category: "transaction",
    metadata: { amount, currency, reason: reason ?? null },
  });
}
