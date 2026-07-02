import { type AuditEvidence, type AuditSection, type DesignAuditReport } from '../services/reportTypes'

type AuditReportCardProps = {
  report: DesignAuditReport
}

function severityClasses(value: AuditSection['severity']) {
  if (value === 'high') return 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300'
  if (value === 'medium') return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
}

function impactClasses(value: AuditSection['impact']) {
  if (value === 'high') return 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
  if (value === 'medium') return 'bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300'
  return 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
}

function sectionEvidence(allEvidence: AuditEvidence[], ids: string[]) {
  const idSet = new Set(ids)
  return allEvidence.filter((item) => idSet.has(item.id)).slice(0, 3)
}

function swatchLabel(value: string) {
  return value.length > 28 ? `${value.slice(0, 28)}...` : value
}

function AuditReportCard({ report }: AuditReportCardProps) {
  const topEvidence = report.evidence.slice(0, 6)
  const downloadUrl = report.jobId ? `/api/design-audit/${report.jobId}/pdf/download` : null
  const colorPaletteScheme =
    report.colorPaletteScheme ?? {
      summary: 'Palette scheme is unavailable for this report. Re-run the audit to generate full color analysis.',
      roles: [],
      textPalette: [],
      surfacePalette: [],
      accentPalette: [],
    }

  return (
    <article className="space-y-5 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80 md:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Design Audit</p>
          <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">{report.metadata.targetUrl}</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Analyzed {new Date(report.metadata.analyzedAt).toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-right dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Overall score</p>
          <p className="text-xl font-extrabold text-zinc-900 dark:text-zinc-100">{report.overallScore}/100</p>
        </div>
      </header>

      <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Executive summary</h3>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{report.executiveSummary}</p>
      </section>

      <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Color palette scheme</h3>
        <p className="text-sm text-zinc-700 dark:text-zinc-300">{colorPaletteScheme.summary}</p>

        <div className="grid gap-2 md:grid-cols-3">
          {colorPaletteScheme.roles.map((item) => (
            <div key={item.role} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
              <div className="mb-2 h-10 rounded-md border border-zinc-300 dark:border-zinc-600" style={{ backgroundColor: item.value }} />
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{item.role}</p>
              <p className="text-[11px] text-zinc-500 dark:text-zinc-400">{swatchLabel(item.value)}</p>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Text palette</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {colorPaletteScheme.textPalette.slice(0, 6).map((item) => (
              <div key={`text-${item.value}`} className="rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
                <div className="mb-2 h-8 rounded border border-zinc-300 dark:border-zinc-600" style={{ backgroundColor: item.value }} />
                <p className="text-[11px] text-zinc-600 dark:text-zinc-300">{swatchLabel(item.value)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Strengths</h3>
          <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
            {report.strengths.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
          <h3 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Weaknesses</h3>
          <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
            {report.weaknesses.map((item) => (
              <li key={item}>• {item}</li>
            ))}
          </ul>
        </div>
      </section>

      {topEvidence.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Key screenshots</h3>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {topEvidence.map((item) => (
              <figure key={item.id} className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                <img src={item.path} alt={item.label} className="h-40 w-full object-cover" loading="lazy" />
                <figcaption className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-300">{item.label} • {item.viewport}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Detailed analysis</h3>
        {report.sections.map((section) => {
          const evidence = sectionEvidence(report.evidence, section.evidenceIds)
          return (
            <div key={section.id} className="space-y-3 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{section.title}</h4>
                  <p className="text-sm text-zinc-700 dark:text-zinc-300">{section.summary}</p>
                </div>
                <div className="flex gap-2">
                  {typeof section.score === 'number' && (
                    <span className="rounded-lg bg-zinc-100 px-2 py-1 text-xs font-semibold text-zinc-700 dark:bg-zinc-700 dark:text-zinc-100">{section.score}/100</span>
                  )}
                  <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${severityClasses(section.severity)}`}>{section.severity} severity</span>
                  <span className={`rounded-lg px-2 py-1 text-xs font-semibold ${impactClasses(section.impact)}`}>{section.impact} impact</span>
                </div>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Findings</p>
                <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {section.findings.map((finding) => (
                    <li key={finding}>• {finding}</li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Recommendations</p>
                <ul className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
                  {section.recommendations.map((recommendation) => (
                    <li key={recommendation}>• {recommendation}</li>
                  ))}
                </ul>
              </div>

              {evidence.length > 0 && (
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {evidence.map((item) => (
                    <figure key={item.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
                      <img src={item.path} alt={item.label} className="h-28 w-full object-cover" loading="lazy" />
                      <figcaption className="px-2 py-1 text-[11px] text-zinc-600 dark:text-zinc-300">{item.label}</figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </section>

      <section className="space-y-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-800/70">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Prioritized recommendations</h3>
        <ol className="space-y-1 text-sm text-zinc-700 dark:text-zinc-300">
          {report.prioritizedRecommendations.map((item, index) => (
            <li key={item}>{index + 1}. {item}</li>
          ))}
        </ol>
      </section>

      <div className="flex justify-end">
        <div className="flex items-center gap-2">
          {downloadUrl ? (
            <a
              href={downloadUrl}
              className="rounded-xl border border-zinc-300 bg-zinc-900 px-3 py-2 text-xs font-semibold text-white transition hover:bg-zinc-800 dark:border-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
            >
              Download PDF
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => window.print()}
            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            Export / Print report
          </button>
        </div>
      </div>
    </article>
  )
}

export default AuditReportCard
