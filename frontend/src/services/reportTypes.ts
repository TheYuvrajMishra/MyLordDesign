export type Severity = 'low' | 'medium' | 'high'
export type Impact = 'low' | 'medium' | 'high'

export type AuditEvidence = {
  id: string
  label: string
  path: string
  viewport: 'desktop' | 'mobile'
  type: string
}

export type AuditSection = {
  id: string
  title: string
  summary: string
  findings: string[]
  recommendations: string[]
  severity: Severity
  impact: Impact
  score?: number
  evidenceIds: string[]
}

export type AuditMetadata = {
  targetUrl: string
  analyzedAt: string
  durationMs: number
  viewportModes: Array<'desktop' | 'mobile'>
}

export type ColorToken = {
  value: string
  count: number
}

export type ColorRole = {
  role: string
  value: string
}

export type ColorPaletteScheme = {
  summary: string
  roles: ColorRole[]
  textPalette: ColorToken[]
  surfacePalette: ColorToken[]
  accentPalette: ColorToken[]
}

export type DesignAuditReport = {
  jobId?: string
  executiveSummary: string
  overallScore: number
  strengths: string[]
  weaknesses: string[]
  prioritizedRecommendations: string[]
  sections: AuditSection[]
  evidence: AuditEvidence[]
  metadata: AuditMetadata
  colorPaletteScheme?: ColorPaletteScheme
  diagnostics: Record<string, unknown>
}
