import { Octokit } from '@octokit/rest'

const octokit = new Octokit({
  auth: import.meta.env.VITE_GITHUB_TOKEN,
})

export interface DocMeta {
  filename: string
  path: string
  sha: string
  downloadUrl: string
}

function parseRepo(repo: string): { owner: string; repoName: string } {
  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    throw new Error(`Invalid repo format "${repo}". Expected "owner/repo".`)
  }
  return { owner, repoName }
}

export async function listDocs(repo: string, folderPath: string): Promise<DocMeta[]> {
  const { owner, repoName } = parseRepo(repo)

  const response = await octokit.repos.getContent({
    owner,
    repo: repoName,
    path: folderPath,
  })

  const data = response.data
  if (!Array.isArray(data)) {
    throw new Error(`Expected a directory at path "${folderPath}", got a file.`)
  }

  return data
    .filter((item) => item.type === 'file' && item.name.endsWith('.md'))
    .map((item) => ({
      filename: item.name,
      path: item.path,
      sha: item.sha,
      downloadUrl: item.download_url ?? '',
    }))
}

export async function readDoc(
  repo: string,
  path: string
): Promise<{ content: string; sha: string }> {
  const { owner, repoName } = parseRepo(repo)

  const response = await octokit.repos.getContent({
    owner,
    repo: repoName,
    path,
  })

  const data = response.data
  if (Array.isArray(data) || data.type !== 'file') {
    throw new Error(`Path "${path}" is not a file.`)
  }

  const raw = data.content ?? ''
  // GitHub returns base64-encoded content with newlines; strip them before decoding
  const decoded = atob(raw.replace(/\n/g, ''))

  return { content: decoded, sha: data.sha }
}

export async function saveDoc(
  repo: string,
  path: string,
  content: string,
  message: string,
  sha?: string
): Promise<void> {
  const { owner, repoName } = parseRepo(repo)

  // Encode content to base64
  const encoded = btoa(unescape(encodeURIComponent(content)))

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo: repoName,
    path,
    message,
    content: encoded,
    ...(sha ? { sha } : {}),
  })
}
