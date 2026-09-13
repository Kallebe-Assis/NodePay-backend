import type { ChangelogEntry, ChangelogResponse } from '@nodepay/shared';
import { env } from '../../config/env.js';

/**
 * Os dois repositórios que compõem "o sistema" (front + back).
 * `nodepay_front` é privado — sem `GITHUB_TOKEN` configurado (um Personal
 * Access Token com acesso de leitura a ele), a API do GitHub responde 404
 * pra esse repo e só os commits do backend (público) aparecem no changelog.
 */
const REPOS: { key: ChangelogEntry['repo']; owner: string; name: string }[] = [
  { key: 'backend', owner: 'Kallebe-Assis', name: 'NodePay-backend' },
  { key: 'frontend', owner: 'Kallebe-Assis', name: 'nodepay_front' },
];

interface GhCommit {
  sha: string;
  html_url: string;
  commit: { message: string; author: { date: string } | null };
}

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min — evita bater o rate-limit do GitHub a cada acesso
let cache: { at: number; data: ChangelogResponse } | null = null;

async function fetchAllCommits(owner: string, name: string): Promise<GhCommit[]> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'nodepay-app',
  };
  if (env.GITHUB_TOKEN) headers.Authorization = `Bearer ${env.GITHUB_TOKEN}`;

  const all: GhCommit[] = [];
  for (let page = 1; ; page += 1) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/commits?per_page=100&page=${page}`,
      { headers },
    );
    if (!res.ok) {
      throw new Error(`GitHub API retornou ${res.status} para ${owner}/${name}`);
    }
    const batch = (await res.json()) as GhCommit[];
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/**
 * Changelog "do sistema": une os commits dos dois repositórios (backend +
 * frontend) numa linha do tempo só, e numera cada um incrementalmente —
 * o 1º commit de todos é 1.0, o próximo 1.1 … 1.9, 2.0, 2.1 e assim por
 * diante. Busca na API pública do GitHub (sem precisar de git local, que
 * em produção costuma ser um clone raso sem o histórico inteiro).
 */
export class ChangelogService {
  async list(): Promise<ChangelogResponse> {
    if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

    // Cada repositório é buscado de forma independente — um falhar (ex.: o
    // privado sem GITHUB_TOKEN) não pode derrubar o changelog inteiro; o
    // outro repositório continua aparecendo normalmente.
    const perRepo = await Promise.all(
      REPOS.map(async (r) => {
        try {
          const commits = await fetchAllCommits(r.owner, r.name);
          return commits
            .filter((c) => c.commit.author?.date)
            .map((c): Omit<ChangelogEntry, 'version'> => ({
              repo: r.key,
              sha: c.sha,
              shortSha: c.sha.slice(0, 7),
              message: c.commit.message.split('\n')[0]!.trim(),
              date: c.commit.author!.date,
              url: c.html_url,
            }));
        } catch (err) {
          console.warn(
            `[changelog] falha ao buscar commits de ${r.owner}/${r.name}:`,
            err instanceof Error ? err.message : err,
          );
          return [];
        }
      }),
    );

    if (perRepo.every((c) => c.length === 0) && cache) {
      // Os dois repositórios falharam agora — melhor servir um cache velho do que uma tela vazia.
      return cache.data;
    }

    // cronológico ascendente pra numerar a versão; depois inverte pra exibir.
    const ascending = perRepo.flat().sort((a, b) => a.date.localeCompare(b.date));
    const entries: ChangelogEntry[] = ascending.map((entry, i) => ({
      ...entry,
      version: `${Math.floor(i / 10) + 1}.${i % 10}`,
    }));
    entries.reverse();

    const data: ChangelogResponse = {
      entries,
      latestVersion: entries[0]?.version ?? '1.0',
      lastUpdatedAt: entries[0]?.date ?? null,
    };
    cache = { at: Date.now(), data };
    return data;
  }
}
