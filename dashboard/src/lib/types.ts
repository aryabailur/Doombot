export type StepStatus = 'running' | 'done' | 'error'

export interface Evidence {
  type: 'issue' | 'pr' | 'file' | 'rule'
  ref: string
  score: number | null
  snippet: string
}

export interface StepRecord {
  step_id: string
  investigation_id: string
  seq: number
  name: string
  title: string
  status: StepStatus
  input_summary: string
  output_summary: string
  evidence: Evidence[]
  duration_ms: number
  started_at: string
  ended_at: string | null
}
