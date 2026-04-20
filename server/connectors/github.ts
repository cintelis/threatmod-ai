import { Octokit } from '@octokit/rest';
import { config } from '../config';

export interface DocMeta {
  filename: string;
  path: string;
  sha: string;
  size: number;
}

const octokit = new Octokit({ auth: config.github.token });

function parseRepo(repo: string): { owner: string; repo: string } {
  const slash = repo.indexOf('/');
  if (slash === -1) {
    throw new Error(`Invalid repo format "${repo}": expected "owner/repo"`);
  }
  return { owner: repo.slice(0, slash), repo: repo.slice(slash + 1) };
}

function retryAfterMs(headers: Record<string, string | undefined>): number {
  const retryAfter = headers['retry-after'];
  const seconds = retryAfter ? parseInt(retryAfter, 10) : 60;
  return (Number.isFinite(seconds) ? seconds : 60) * 1000;
}

function isRetryable(status: number): boolean {
  return status === 429 || status === 503;
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const e = err as { status?: number; response?: { headers?: Record<string, string | undefined> }; message?: string };
      const status = e.status;

      if (typeof status === 'number' && isRetryable(status) && attempt < maxAttempts) {
        const waitMs = retryAfterMs(e.response?.headers ?? {});
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      if (typeof status === 'number') {
        throw new Error(`GitHub API error ${status}: ${e.message ?? 'unknown error'}`);
      }

      throw err;
    }
  }
  throw new Error('GitHub API: exceeded maximum retry attempts');
}

export async function listArchitectureDocs(repo: string, folderPath: string): Promise<DocMeta[]> {
  const { owner, repo: repoName } = parseRepo(repo);

  return withRetry(async () => {
    const { data } = await octokit.repos.getContent({ owner, repo: repoName, path: folderPath });

    if (!Array.isArray(data)) {
      throw new Error(`GitHub API error: expected directory listing for "${folderPath}" but got a single file`);
    }

    return data
      .filter((item) => item.type === 'file' && item.name.endsWith('.md'))
      .map((item) => ({
        filename: item.name,
        path: item.path,
        sha: item.sha,
        size: item.size,
      }));
  });
}

export async function readFile(repo: string, path: string): Promise<{ content: string; sha: string }> {
  const { owner, repo: repoName } = parseRepo(repo);

  return withRetry(async () => {
    const { data } = await octokit.repos.getContent({ owner, repo: repoName, path });

    if (Array.isArray(data) || data.type !== 'file') {
      throw new Error(`GitHub API error: expected file at "${path}" but got a directory`);
    }

    const encoded = (data as { content: string; sha: string }).content;
    const content = Buffer.from(encoded, 'base64').toString('utf-8');

    return { content, sha: data.sha };
  });
}

export async function commitFile(
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string,
): Promise<void> {
  const { owner, repo: repoName } = parseRepo(repo);
  const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

  await withRetry(async () => {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo: repoName,
      path,
      message,
      content: encodedContent,
      ...(sha !== undefined ? { sha } : {}),
    });
  });
}
