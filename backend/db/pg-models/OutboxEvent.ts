/**
 * backend/db/pg-models/OutboxEvent.ts
 *
 * Sequelize model for the `outbox_events` table in PostgreSQL.
 * Used for the transactional outbox pattern to reliably publish events.
 */

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { pgSequelize } from "../postgres.js";

export class OutboxEvent extends Model<
  InferAttributes<OutboxEvent>,
  InferCreationAttributes<OutboxEvent>
> {
  declare id: CreationOptional<string>;
  declare event_type: string;
  declare aggregate_id: string;
  declare payload: Record<string, unknown>;
  declare processed_at: CreationOptional<Date | null>;
  declare retry_count: CreationOptional<number>;
  declare error: CreationOptional<string | null>;
  declare readonly created_at: CreationOptional<Date>;
}

OutboxEvent.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    event_type: { type: DataTypes.STRING(100), allowNull: false },
    aggregate_id: { type: DataTypes.STRING(128), allowNull: false },
    payload: { type: DataTypes.JSONB, allowNull: false, defaultValue: {} },
    processed_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    retry_count: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    error: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize: pgSequelize,
    tableName: "outbox_events",
    timestamps: false,
    indexes: [
      { fields: ["created_at"] },
      { fields: ["aggregate_id"] },
    ],
  }
);
