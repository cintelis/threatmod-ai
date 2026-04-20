import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import MDEditor from '@uiw/react-md-editor'
import { useDocument } from '../hooks/useGitHub'
import { saveDoc } from '../api/github'

const REPO = import.meta.env.VITE_GITHUB_REPO as string
const FOLDER = import.meta.env.VITE_GITHUB_FOLDER as string

type SaveStatus = 'idle' | 'saving' | 'success' | 'error'

export default function DocumentEditor() {
  const navigate = useNavigate()
  const { path: encodedPath } = useParams<{ path?: string }>()

  const isNew = encodedPath === undefined
  const filePath = isNew ? null : decodeURIComponent(encodedPath)

  const { content: initialContent, sha, loading, error: loadError } = useDocument(REPO, filePath)

  const [content, setContent] = useState('')
  const [filename, setFilename] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)

  // Populate editor once data arrives
  useEffect(() => {
    if (!isNew && initialContent !== '') {
      setContent(initialContent)
      setIsDirty(false)
    }
  }, [isNew, initialContent])

  // Warn on unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  const handleContentChange = useCallback((val: string | undefined) => {
    setContent(val ?? '')
    setIsDirty(true)
  }, [])

  const handleSave = useCallback(async () => {
    setSaveError(null)

    if (isNew && !filename.trim()) {
      setSaveError('Please enter a filename.')
      return
    }

    const targetPath = isNew
      ? `${FOLDER}/${filename.trim().endsWith('.md') ? filename.trim() : `${filename.trim()}.md`}`
      : (filePath as string)

    const commitMessage = isNew
      ? `Add ${targetPath}`
      : `Update ${targetPath}`

    setSaveStatus('saving')
    try {
      await saveDoc(REPO, targetPath, content, commitMessage, sha || undefined)
      setSaveStatus('success')
      setIsDirty(false)

      // Navigate back after a short delay so user sees success state
      setTimeout(() => navigate('/'), 1200)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : String(err))
    }
  }, [isNew, filename, filePath, content, sha, navigate])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-500">
        <svg
          className="animate-spin h-6 w-6 mr-3 text-blue-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading document…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
          <strong>Failed to load document:</strong> {loadError}
        </div>
        <button
          onClick={() => navigate('/')}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          &larr; Back to list
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-screen">
      {/* Top bar */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white shadow-sm">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => {
              if (isDirty && !window.confirm('You have unsaved changes. Leave anyway?')) return
              navigate('/')
            }}
            className="text-sm text-blue-600 hover:underline shrink-0"
          >
            &larr; Documents
          </button>

          {isNew ? (
            <div className="flex items-center gap-2">
              <span className="text-gray-400">/</span>
              <input
                type="text"
                placeholder="filename.md"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                className="border border-gray-300 rounded px-2 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
              />
            </div>
          ) : (
            <div className="flex items-center gap-1 text-sm text-gray-600 min-w-0 overflow-hidden">
              <span className="text-gray-400">/</span>
              <span className="font-mono truncate" title={filePath ?? ''}>
                {filePath}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {saveStatus === 'success' && (
            <span className="text-green-600 text-sm font-medium">Saved!</span>
          )}
          {saveStatus === 'error' && saveError && (
            <span className="text-red-600 text-sm">{saveError}</span>
          )}
          {isNew && !filename.trim() && saveError && (
            <span className="text-red-600 text-sm">{saveError}</span>
          )}

          <button
            onClick={handleSave}
            disabled={saveStatus === 'saving'}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saveStatus === 'saving' ? (
              <>
                <svg
                  className="animate-spin h-4 w-4"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Saving…
              </>
            ) : (
              'Save'
            )}
          </button>
        </div>
      </header>

      {/* Editor */}
      <main className="flex-1 overflow-hidden" data-color-mode="light">
        <MDEditor
          value={content}
          onChange={handleContentChange}
          preview="live"
          height="100%"
          style={{ height: '100%', borderRadius: 0, border: 'none' }}
          visibleDragbar={false}
        />
      </main>
    </div>
  )
}
