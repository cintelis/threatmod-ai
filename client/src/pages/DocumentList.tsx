import { useNavigate } from 'react-router-dom'
import { useDocumentList } from '../hooks/useGitHub'

const REPO = import.meta.env.VITE_GITHUB_REPO as string
const FOLDER = import.meta.env.VITE_GITHUB_FOLDER as string

export default function DocumentList() {
  const navigate = useNavigate()
  const { docs, loading, error, refetch } = useDocumentList(REPO, FOLDER)

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">Architecture Documents</h1>
        <button
          onClick={() => navigate('/new')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
        >
          + New Document
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-gray-500">
          <svg
            className="animate-spin h-6 w-6 mr-3 text-blue-500"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Loading documents…
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-red-700 text-sm">
          <strong>Error:</strong> {error}
          <button
            onClick={refetch}
            className="ml-3 underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      )}

      {!loading && !error && docs.length === 0 && (
        <p className="text-gray-500 text-sm py-8 text-center">
          No markdown files found in <code className="bg-gray-100 px-1 rounded">{FOLDER}</code>.
        </p>
      )}

      {!loading && !error && docs.length > 0 && (
        <div className="border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Filename</th>
                <th className="text-left px-4 py-3 font-medium text-gray-600">Path</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((doc, idx) => (
                <tr
                  key={doc.sha}
                  className={`cursor-pointer hover:bg-blue-50 transition-colors ${
                    idx < docs.length - 1 ? 'border-b border-gray-100' : ''
                  }`}
                  onClick={() => navigate(`/edit/${encodeURIComponent(doc.path)}`)}
                >
                  <td className="px-4 py-3 font-medium text-blue-600 hover:underline">
                    {doc.filename}
                  </td>
                  <td className="px-4 py-3 text-gray-500 font-mono text-xs">{doc.path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
