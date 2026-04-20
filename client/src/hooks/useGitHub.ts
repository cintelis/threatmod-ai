import { useState, useEffect, useCallback } from 'react'
import { listDocs, readDoc } from '../api/github'
import type { DocMeta } from '../api/github'

export function useDocumentList(
  repo: string,
  folder: string
): {
  docs: DocMeta[]
  loading: boolean
  error: string | null
  refetch: () => void
} {
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    listDocs(repo, folder)
      .then((result) => {
        if (!cancelled) {
          setDocs(result)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [repo, folder, tick])

  const refetch = useCallback(() => setTick((t) => t + 1), [])

  return { docs, loading, error, refetch }
}

export function useDocument(
  repo: string,
  path: string | null
): {
  content: string
  sha: string
  loading: boolean
  error: string | null
} {
  const [content, setContent] = useState('')
  const [sha, setSha] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (path === null) {
      setContent('')
      setSha('')
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    readDoc(repo, path)
      .then((result) => {
        if (!cancelled) {
          setContent(result.content)
          setSha(result.sha)
          setLoading(false)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [repo, path])

  return { content, sha, loading, error }
}
