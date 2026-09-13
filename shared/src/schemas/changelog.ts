import { z } from 'zod';

/**
 * Um commit do GitHub (backend ou frontend) já traduzido pra versão
 * incremental do app: o 1º commit de todos (nos dois repositórios,
 * cronologicamente) é a versão 1.0; a cada commit seguinte soma 0.1 — ao
 * chegar em X.9, o próximo vira (X+1).0.
 */
export const changelogEntrySchema = z.object({
  version: z.string(),
  repo: z.enum(['backend', 'frontend']),
  sha: z.string(),
  shortSha: z.string(),
  message: z.string(),
  date: z.string(),
  url: z.string(),
});
export type ChangelogEntry = z.infer<typeof changelogEntrySchema>;

export const changelogResponseSchema = z.object({
  /** mais recente primeiro */
  entries: z.array(changelogEntrySchema),
  latestVersion: z.string(),
  lastUpdatedAt: z.string().nullable(),
});
export type ChangelogResponse = z.infer<typeof changelogResponseSchema>;
