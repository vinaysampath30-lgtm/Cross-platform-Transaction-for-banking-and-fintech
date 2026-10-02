/**
 * backend/db/pg-models/OtpChallenge.ts
 *
 * Sequelize model for the `otp_challenges` table in PostgreSQL.
 * Stores hashed OTP codes for transaction confirmation and MFA.
 */

import {
  DataTypes,
  Model,
  InferAttributes,
  InferCreationAttributes,
  CreationOptional,
} from "sequelize";
import { pgSequelize } from "../postgres.js";

export class OtpChallenge extends Model<
  InferAttributes<OtpChallenge>,
  InferCreationAttributes<OtpChallenge>
> {
  declare id: CreationOptional<string>;
  declare user_id: string;
  declare otp_hash: string;
  declare purpose: "transfer" | "login_mfa" | "password_reset";
  declare context: CreationOptional<Record<string, unknown> | null>;
  declare expires_at: Date;
  declare verified_at: CreationOptional<Date | null>;
  declare attempts: CreationOptional<number>;
  declare readonly created_at: CreationOptional<Date>;
}

OtpChallenge.init(
  {
    id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
    user_id: { type: DataTypes.UUID, allowNull: false },
    otp_hash: { type: DataTypes.STRING(64), allowNull: false },
    purpose: { type: DataTypes.STRING(50), allowNull: false },
    context: { type: DataTypes.JSONB, allowNull: true, defaultValue: null },
    expires_at: { type: DataTypes.DATE, allowNull: false },
    verified_at: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
    attempts: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  },
  {
    sequelize: pgSequelize,
    tableName: "otp_challenges",
    timestamps: false,
    indexes: [{ fields: ["user_id", "created_at"] }],
  }
);
