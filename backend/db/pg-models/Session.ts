/**
 * backend/db/pg-models/Session.ts
 *
 * Sequelize model for the `sessions` table in PostgreSQL.
 * Stores hashed refresh tokens for the sliding-session / token rotation pattern.
 */

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { pgSequelize } from "../postgres.js";

export class Session extends Model<
  InferAttributes<Session>,
  InferCreationAttributes<Session>
> {
  declare id: CreationOptional<string>;
  declare user_id: string;
  declare refresh_token_hash: string;
  declare device_name: CreationOptional<string | null>;
  declare ip_address: CreationOptional<string | null>;
  declare user_agent: CreationOptional<string | null>;
  declare expires_at: Date;
  declare revoked_at: CreationOptional<Date | null>;
  declare readonly created_at: CreationOptional<Date>;
}

Session.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    user_id: { type: DataTypes.UUID, allowNull: false },
    refresh_token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
    device_name: { type: DataTypes.STRING(200), allowNull: true, defaultValue: null },
    ip_address: { type: DataTypes.STRING(45), allowNull: true, defaultValue: null },
    user_agent: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize: pgSequelize,
    tableName: "sessions",
    timestamps: false,
    indexes: [
      { fields: ["user_id"] },
      { fields: ["refresh_token_hash"] },
    ],
  }
);
