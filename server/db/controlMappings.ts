import { db } from './client'

export interface ControlMapping {
  framework: string
  control_id: string
  control_name: string
  description: string
}

export function getControlsForCategory(strideCategory: string): ControlMapping[] {
  return db
    .prepare(
      'SELECT framework, control_id, control_name, description FROM control_mappings WHERE stride_category = ? ORDER BY framework, control_id'
    )
    .all(strideCategory) as ControlMapping[]
}

export function getAllCategories(): string[] {
  const rows = db
    .prepare('SELECT DISTINCT stride_category FROM control_mappings')
    .all() as { stride_category: string }[]
  return rows.map((r) => r.stride_category)
}
