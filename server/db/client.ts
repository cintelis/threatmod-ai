import Database from 'better-sqlite3'
import path from 'path'

const dbPath = path.resolve(__dirname, '../../threatmod.db')

export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')

export function checkDbHealth(): boolean {
  try {
    db.prepare('SELECT 1').get()
    return true
  } catch {
    return false
  }
}
