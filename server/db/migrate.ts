import fs from 'fs'
import path from 'path'
import { db } from './client'

const migrationsDir = path.resolve(__dirname, 'migrations')

const files = fs.readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

for (const file of files) {
  const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
  db.exec(sql)
  console.log(`Migration applied: ${file}`)
}

console.log('All migrations complete')

interface ControlMappingSeed {
  stride_category: string
  framework: string
  control_id: string
  control_name: string
  description: string
}

const countRow = db.prepare('SELECT COUNT(*) as count FROM control_mappings').get() as { count: number }

if (countRow.count === 0) {
  const seedPath = path.resolve(__dirname, 'seeds/control_mappings.json')
  const seeds = JSON.parse(fs.readFileSync(seedPath, 'utf-8')) as ControlMappingSeed[]

  const insert = db.prepare(`
    INSERT INTO control_mappings (stride_category, framework, control_id, control_name, description)
    VALUES (@stride_category, @framework, @control_id, @control_name, @description)
  `)

  const insertMany = db.transaction((rows: ControlMappingSeed[]) => {
    for (const row of rows) {
      insert.run(row)
    }
  })

  insertMany(seeds)
  console.log(`Seeded ${seeds.length} control mappings`)
} else {
  console.log('control_mappings already seeded, skipping')
}
