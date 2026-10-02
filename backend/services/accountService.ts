import { randomUUID } from "node:crypto";
import { AccountPg } from "../db/pg-models/AccountPg.js";
import type { CreateAccountInput } from "../validation/schemas.js";

export interface AccountResponse { id: string; accountNumber: string; balance: string; currency: string; createdAt: Date; }
function accountNumber(): string { return Array.from({ length: 4 }, () => String(Math.floor(1000 + Math.random() * 9000))).join("-"); }
function response(account: AccountPg): AccountResponse { return { id: account.id, accountNumber: account.account_number, balance: account.balance, currency: account.currency, createdAt: account.created_at }; }

export async function createAccount(userId: string, input: CreateAccountInput): Promise<AccountResponse> {
  if (await AccountPg.findOne({ where: { user_id: userId, currency: input.currency } })) throw new Error(`ACCOUNT_EXISTS_${input.currency}`);
  return response(await AccountPg.create({ id: randomUUID(), user_id: userId, account_number: input.accountNumber || accountNumber(), balance: input.initialBalance || "0.0000", currency: input.currency, version_id: 0 }));
}
export async function getUserAccounts(userId: string): Promise<AccountResponse[]> {
  return (await AccountPg.findAll({ where: { user_id: userId }, order: [["created_at", "ASC"]] })).map(response);
}
export async function getAccountById(accountId: string, userId: string): Promise<AccountResponse | null> {
  if (!/^[0-9a-f-]{36}$/i.test(accountId)) return null;
  const account = await AccountPg.findOne({ where: { id: accountId, user_id: userId } });
  return account ? response(account) : null;
}
export async function getAccountByNumber(accountNumberValue: string): Promise<{ id: string; userId: string; balance: string; currency: string } | null> {
  const account = await AccountPg.findOne({ where: { account_number: accountNumberValue.trim() } });
  return account ? { id: account.id, userId: account.user_id, balance: account.balance, currency: account.currency } : null;
}
