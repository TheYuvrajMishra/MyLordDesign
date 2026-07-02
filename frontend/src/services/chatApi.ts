import axios from 'axios'
import { type DesignAuditReport } from './reportTypes'

type ChatReply = {
  reply: string
  report?: DesignAuditReport
  mode?: 'text' | 'audit-started' | 'audit'
  jobId?: string
}

export type AuditJobState = {
  jobId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  progress: number
  currentStep: string
  logs: Array<{
    message: string
    progress: number
    at: string
  }>
  report: DesignAuditReport | null
  error: string | null
}

export async function sendChatMessage(message: string): Promise<ChatReply> {
  const { data } = await axios.post<ChatReply>('/api/chat', { message })
  return data
}

export async function startDesignAudit(url: string): Promise<{ jobId: string; reply: string }> {
  const { data } = await axios.post<{ jobId: string; reply: string }>('/api/design-audit/start', { url })
  return data
}

export async function getDesignAuditJob(jobId: string): Promise<AuditJobState> {
  const { data } = await axios.get<AuditJobState>(`/api/design-audit/${jobId}`)
  return data
}
