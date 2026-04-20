import { Routes, Route } from 'react-router-dom'
import DocumentList from './pages/DocumentList'
import DocumentEditor from './pages/DocumentEditor'

export default function App() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      <Routes>
        <Route path="/" element={<DocumentList />} />
        <Route path="/edit/:path" element={<DocumentEditor />} />
        <Route path="/new" element={<DocumentEditor />} />
      </Routes>
    </div>
  )
}
