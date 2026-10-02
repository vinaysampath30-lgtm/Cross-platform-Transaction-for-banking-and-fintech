import { randomUUID } from "node:crypto";
import { BeneficiaryPg } from "../db/pg-models/BeneficiaryPg.js";
import type { CreateBeneficiaryInput, UpdateBeneficiaryInput } from "../validation/schemas.js";

export interface BeneficiaryResponse { id: string; name: string; accountNumber: string; bankName: string | null; bankCode: string | null; currency: string; nickname: string | null; isFavorite: boolean; createdAt: Date; }
function response(b: BeneficiaryPg): BeneficiaryResponse { return { id: b.id, name: b.name, accountNumber: b.account_number, bankName: b.bank_name, bankCode: b.bank_code, currency: b.currency, nickname: b.nickname, isFavorite: b.is_favorite, createdAt: b.created_at }; }
export async function createBeneficiary(userId: string, input: CreateBeneficiaryInput): Promise<BeneficiaryResponse> {
  try { return response(await BeneficiaryPg.create({ id: randomUUID(), user_id: userId, name: input.name.trim(), account_number: input.accountNumber.trim(), bank_name: input.bankName?.trim() || null, bank_code: input.bankCode?.trim() || null, currency: input.currency || "USD", nickname: input.nickname?.trim() || null, is_favorite: input.isFavorite || false })); }
  catch (error: any) { if (error?.name === "SequelizeUniqueConstraintError") throw new Error("BENEFICIARY_EXISTS"); throw error; }
}
export async function getUserBeneficiaries(userId: string): Promise<BeneficiaryResponse[]> { return (await BeneficiaryPg.findAll({ where: { user_id: userId }, order: [["is_favorite", "DESC"], ["name", "ASC"]] })).map(response); }
export async function getBeneficiaryById(id: string, userId: string): Promise<BeneficiaryResponse | null> { if (!/^[0-9a-f-]{36}$/i.test(id)) return null; const b = await BeneficiaryPg.findOne({ where: { id, user_id: userId } }); return b ? response(b) : null; }
export async function updateBeneficiary(id: string, userId: string, input: UpdateBeneficiaryInput): Promise<BeneficiaryResponse> {
  const b = await BeneficiaryPg.findOne({ where: { id, user_id: userId } }); if (!b) throw new Error("BENEFICIARY_NOT_FOUND");
  await b.update({ name: input.name?.trim() ?? b.name, bank_name: input.bankName?.trim() ?? b.bank_name, bank_code: input.bankCode?.trim() ?? b.bank_code, nickname: input.nickname?.trim() ?? b.nickname, is_favorite: input.isFavorite ?? b.is_favorite }); return response(b);
}
export async function deleteBeneficiary(id: string, userId: string): Promise<void> { const count = await BeneficiaryPg.destroy({ where: { id, user_id: userId } }); if (!count) throw new Error("BENEFICIARY_NOT_FOUND"); }
