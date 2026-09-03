import { z } from 'zod';
import { LoanStatus, LoanSystem } from '../constants.js';
import { centsSchema, isoDateSchema } from './common.js';

export const loanSystemSchema = z.nativeEnum(LoanSystem);
export const loanStatusSchema = z.nativeEnum(LoanStatus);

export const createLoanBodySchema = z.object({
  lender: z.string().min(1, 'Informe o credor').max(120),
  principal: centsSchema,
  /** juros ao mês em % (ex.: 1.99). Convertido para fração na API. */
  monthlyInterestPercent: z.number().min(0).max(100),
  installments: z.number().int().min(1).max(600),
  firstDueDate: isoDateSchema,
  system: loanSystemSchema.default(LoanSystem.PRICE),
  /** conta onde o valor liberado será creditado (opcional). */
  disbursementAccountId: z.string().nullable().optional(),
  disbursementDate: isoDateSchema.optional(),
  categoryId: z.string().nullable().optional(),
  notes: z.string().max(500).optional(),
});
export type CreateLoanBody = z.infer<typeof createLoanBodySchema>;

export const loanInstallmentSchema = z.object({
  id: z.string(),
  number: z.number().int(),
  dueDate: isoDateSchema,
  interest: z.number().int(),
  principal: z.number().int(),
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  paidTransactionId: z.string().nullable(),
  paid: z.boolean(),
});
export type LoanInstallment = z.infer<typeof loanInstallmentSchema>;

export const loanSchema = z.object({
  id: z.string(),
  lender: z.string(),
  principal: z.number().int(),
  monthlyInterestPercent: z.number(),
  installments: z.number().int(),
  firstDueDate: isoDateSchema,
  system: loanSystemSchema,
  status: loanStatusSchema,
  notes: z.string().nullable(),
  createdAt: z.string(),
  // calculado
  totalInterest: z.number().int(),
  totalPaid: z.number().int(),
  outstandingBalance: z.number().int(),
  paidInstallments: z.number().int(),
  schedule: z.array(loanInstallmentSchema).optional(),
});
export type Loan = z.infer<typeof loanSchema>;

export const settleLoanBodySchema = z.object({
  accountId: z.string().min(1),
  settlementDate: isoDateSchema,
  amount: z.number().int().positive().optional(),
});
export type SettleLoanBody = z.infer<typeof settleLoanBodySchema>;
