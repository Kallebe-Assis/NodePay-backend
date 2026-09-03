import type { PrismaClient } from '@prisma/client';
import {
  IMPORT_CSV_HEADERS,
  IMPORT_MAX_ROWS,
  type ImportRow,
  reaisToCents,
  todaySP,
} from '@nodepay/shared';
import { Errors } from '../../lib/errors.js';
import { numToBig } from '../../lib/money.js';
import { isoToDbDate } from '../../lib/date.js';

/** Modelo CSV para download (cabeçalho + 1 linha de exemplo). */
export function importTemplateCsv(): string {
  const example = [
    todaySP(),
    'despesa',
    'Mercado do mês',
    '199,90',
    'Nubank',
    'Alimentação',
    'sim',
  ];
  return `${IMPORT_CSV_HEADERS.join(';')}\r\n${example.join(';')}\r\n`;
}

/** Analisa o CSV, valida cada linha contra as contas/categorias do usuário. */
export async function previewImport(db: PrismaClient, userId: string, csv: string) {
  const records = parseCsv(csv);
  if (records.length === 0) throw Errors.badRequest('CSV vazio ou sem linhas de dados.');
  if (records.length > IMPORT_MAX_ROWS) {
    throw Errors.badRequest(`Máximo de ${IMPORT_MAX_ROWS} lançamentos por importação.`);
  }

  const [accounts, categories, rules] = await Promise.all([
    db.account.findMany({ where: { userId, archived: false }, select: { id: true, name: true } }),
    db.category.findMany({ where: { userId }, select: { id: true, name: true, kind: true } }),
    db.categoryRule.findMany({
      where: { userId, active: true },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      select: { match: true, categoryId: true },
    }),
  ]);
  const accByName = new Map(accounts.map((a) => [norm(a.name), a]));
  const catByName = new Map(categories.map((c) => [norm(c.name), c]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  /** aplica as regras de auto-categorização a uma descrição (em memória). */
  const ruleCategory = (description: string) => {
    const hay = norm(description);
    for (const r of rules) {
      if (r.match && hay.includes(r.match)) return catById.get(r.categoryId) ?? null;
    }
    return null;
  };

  const rows: ImportRow[] = records.map((rec, i) => {
    const line = i + 2; // +1 header, +1 base-1
    const get = (k: string) => (rec[k] ?? '').trim();

    const draft: ImportRow = {
      line,
      ok: false,
      error: null,
      date: get('data'),
      direction: 'expense',
      description: get('descricao'),
      amount: 0,
      accountName: get('conta'),
      categoryName: get('categoria') || null,
      paid: /^(s|sim|1|true|yes)$/i.test(get('pago')),
    };

    const errs: string[] = [];

    // data
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(Date.parse(`${draft.date}T00:00:00Z`))) {
      errs.push('data inválida (use AAAA-MM-DD)');
    }

    // tipo
    const tipo = norm(get('tipo'));
    if (['despesa', 'expense', 'saida', 'saída'].includes(tipo)) draft.direction = 'expense';
    else if (['receita', 'income', 'entrada'].includes(tipo)) draft.direction = 'income';
    else errs.push("tipo deve ser 'despesa' ou 'receita'");

    // descrição
    if (!draft.description) errs.push('descrição obrigatória');

    // valor
    const cents = parseAmount(get('valor'));
    if (cents == null || cents <= 0) errs.push('valor inválido (use 199,90)');
    else draft.amount = cents;

    // conta
    const acc = accByName.get(norm(draft.accountName));
    if (!acc) errs.push(`conta "${draft.accountName}" não encontrada`);

    // categoria (opcional). Sem categoria no CSV → tenta as regras de
    // auto-categorização pela descrição.
    if (!draft.categoryName && draft.description) {
      const byRule = ruleCategory(draft.description);
      if (byRule) draft.categoryName = byRule.name;
    }
    if (draft.categoryName) {
      const cat = catByName.get(norm(draft.categoryName));
      if (!cat) errs.push(`categoria "${draft.categoryName}" não encontrada`);
      else if (
        (draft.direction === 'expense' && cat.kind !== 'EXPENSE') ||
        (draft.direction === 'income' && cat.kind !== 'INCOME')
      ) {
        errs.push(`categoria "${draft.categoryName}" não é do tipo ${tipo}`);
      }
    }

    draft.ok = errs.length === 0;
    draft.error = errs.length ? errs.join('; ') : null;
    return draft;
  });

  const valid = rows.filter((r) => r.ok).length;
  return { rows, total: rows.length, valid, invalid: rows.length - valid };
}

/** Reanalisa o CSV, exige 100% válido e insere. */
export async function commitImport(db: PrismaClient, userId: string, csv: string) {
  const preview = await previewImport(db, userId, csv);
  if (preview.invalid > 0) {
    throw Errors.badRequest('Há linhas inválidas. Corrija o arquivo e tente de novo.');
  }

  const [accounts, categories] = await Promise.all([
    db.account.findMany({ where: { userId }, select: { id: true, name: true } }),
    db.category.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);
  const accId = new Map(accounts.map((a) => [norm(a.name), a.id]));
  const catId = new Map(categories.map((c) => [norm(c.name), c.id]));
  const today = todaySP();

  await db.$transaction(
    preview.rows.map((r) =>
      db.transaction.create({
        data: {
          userId,
          type: r.direction === 'expense' ? 'EXPENSE' : 'INCOME',
          amount: numToBig(r.amount),
          description: r.description,
          competenceDate: isoToDbDate(r.date),
          dueDate: isoToDbDate(r.date),
          paidDate: r.paid ? isoToDbDate(r.date) : null,
          status: r.paid ? 'PAID' : r.date > today ? 'SCHEDULED' : 'PENDING',
          accountId: accId.get(norm(r.accountName))!,
          categoryId: r.categoryName ? (catId.get(norm(r.categoryName)) ?? null) : null,
        },
      }),
    ),
  );

  return { created: preview.rows.length };
}

/* ----------------------------- helpers ----------------------------------- */

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase();
}

/** "1.234,56" | "1234.56" | "1234,56" -> centavos (número). */
function parseAmount(raw: string): number | null {
  let s = raw.replace(/\s|R\$/gi, '').trim();
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); // pt-BR
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return reaisToCents(n);
}

/** Parser CSV mínimo: detecta `;` ou `,`, respeita aspas, ignora linhas vazias. */
function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim();
  const lines = clean.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const delim = (lines[0]!.match(/;/g)?.length ?? 0) >= (lines[0]!.match(/,/g)?.length ?? 0) ? ';' : ',';
  const splitRow = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (q) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };

  const headers = splitRow(lines[0]!).map((h) => norm(h));
  return lines.slice(1).map((line) => {
    const cells = splitRow(line);
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => (rec[h] = cells[i] ?? ''));
    return rec;
  });
}
