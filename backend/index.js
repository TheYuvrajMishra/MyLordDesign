const http = require('http')
const fs = require('fs')
const fsPromises = require('fs/promises')
const path = require('path')
const { randomUUID } = require('crypto')
const { runDesignAudit, looksLikeUrl, ARTIFACTS_ROOT, generateReportPdf } = require('./services/designAudit')

const PORT = process.env.PORT || 4000

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json',
}

const MAX_PROGRESS_LOGS = 30
const auditJobs = new Map()

function sendJson(res, status, payload) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(payload))
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let rawBody = ''

    req.on('data', (chunk) => {
      rawBody += chunk
      if (rawBody.length > 1_000_000) {
        reject(new Error('Payload too large.'))
      }
    })

    req.on('end', () => {
      try {
        resolve(rawBody ? JSON.parse(rawBody) : {})
      } catch {
        reject(new Error('Invalid JSON payload.'))
      }
    })

    req.on('error', () => {
      reject(new Error('Failed to read request body.'))
    })
  })
}

async function serveArtifact(req, res) {
  const pathname = req.url.split('?')[0]
  const relativePath = pathname.replace(/^\/artifacts\//, '')
  const safePath = path.normalize(relativePath).replace(/^([.]{2}[\/\\])+/, '')
  const absolutePath = path.join(ARTIFACTS_ROOT, safePath)

  if (!absolutePath.startsWith(ARTIFACTS_ROOT)) {
    sendJson(res, 400, { error: 'Invalid artifact path.' })
    return
  }

  try {
    const buffer = await fsPromises.readFile(absolutePath)
    const ext = path.extname(absolutePath).toLowerCase()

    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    })

    res.end(buffer)
  } catch {
    sendJson(res, 404, { error: 'Artifact not found.' })
  }
}

async function handleDesignAudit(urlValue, res) {
  const startedAt = Date.now()
  const result = await runDesignAudit(urlValue)
  const duration = Date.now() - startedAt

  sendJson(res, 200, {
    reply: `Completed design audit for ${urlValue} in ${Math.round(duration / 1000)}s.`,
    mode: 'audit',
    jobId: result.jobId,
    report: result.report,
  })
}

function createAuditJob(url) {
  const jobId = randomUUID()
  const job = {
    id: jobId,
    url,
    status: 'queued',
    progress: 0,
    currentStep: 'Queued',
    logs: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    report: null,
    error: null,
  }

  auditJobs.set(jobId, job)
  return job
}

function pushJobLog(job, message, progress) {
  job.currentStep = message
  if (typeof progress === 'number') {
    job.progress = Math.max(job.progress, Math.min(100, Math.round(progress)))
  }

  job.logs.push({
    message,
    progress: job.progress,
    at: new Date().toISOString(),
  })

  if (job.logs.length > MAX_PROGRESS_LOGS) {
    job.logs = job.logs.slice(job.logs.length - MAX_PROGRESS_LOGS)
  }

  job.updatedAt = new Date().toISOString()
}

function startAuditJob(job) {
  job.status = 'running'
  pushJobLog(job, 'Audit job started', 2)

  runDesignAudit(job.url, {
    jobId: job.id,
    onProgress: (message, progress) => {
      pushJobLog(job, message, progress)
    },
  })
    .then((result) => {
      job.status = 'completed'
      job.progress = 100
      job.currentStep = 'Completed'
      job.report = result.report
      job.updatedAt = new Date().toISOString()
      pushJobLog(job, 'Audit completed successfully', 100)
    })
    .catch((error) => {
      job.status = 'failed'
      job.currentStep = 'Failed'
      job.error = error.message || 'Audit failed unexpectedly.'
      job.updatedAt = new Date().toISOString()
      pushJobLog(job, `Audit failed: ${job.error}`, job.progress)
    })
}

function sendAuditJobState(res, job) {
  sendJson(res, 200, {
    jobId: job.id,
    url: job.url,
    status: job.status,
    progress: job.progress,
    currentStep: job.currentStep,
    logs: job.logs,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    report: job.status === 'completed' ? job.report : null,
    error: job.error,
  })
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, JSON_HEADERS)
    res.end()
    return
  }

  if (req.method === 'GET' && req.url.startsWith('/artifacts/')) {
    serveArtifact(req, res)
    return
  }

  if (req.method === 'GET' && req.url === '/api/health') {
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'POST' && req.url === '/api/design-audit') {
    readBody(req)
      .then((body) => {
        const url = typeof body.url === 'string' ? body.url.trim() : ''

        if (!url) {
          sendJson(res, 400, { error: 'url is required.' })
          return
        }

        return handleDesignAudit(url, res)
      })
      .catch((error) => {
        sendJson(res, 400, { error: error.message })
      })

    return
  }

  if (req.method === 'POST' && req.url === '/api/design-audit/start') {
    readBody(req)
      .then((body) => {
        const url = typeof body.url === 'string' ? body.url.trim() : ''

        if (!url) {
          sendJson(res, 400, { error: 'url is required.' })
          return
        }

        const job = createAuditJob(url)
        startAuditJob(job)

        sendJson(res, 202, {
          mode: 'audit-started',
          reply: `Started website design audit for ${url}.`,
          jobId: job.id,
          status: job.status,
        })
      })
      .catch((error) => {
        sendJson(res, 400, { error: error.message })
      })

    return
  }

  if (req.method === 'GET' && req.url.startsWith('/api/design-audit/')) {
    const pathname = req.url.split('?')[0]

    // PDF export endpoint: /api/design-audit/:jobId/pdf
    const pdfMatch = pathname.match(/^\/api\/design-audit\/([a-f0-9-]+)\/pdf$/i)
    if (pdfMatch) {
      const jobId = pdfMatch[1]
      const job = auditJobs.get(jobId)
      if (!job) {
        sendJson(res, 404, { error: 'Audit job not found.' })
        return
      }

      if (job.status !== 'completed' || !job.report) {
        sendJson(res, 409, { error: 'Report not available yet. Wait for job to complete.' })
        return
      }

      const pdfRel = path.join(jobId, 'report.pdf')
      const pdfAbs = path.join(ARTIFACTS_ROOT, pdfRel)

      fs.access(pdfAbs)
        .then(async () => {
          sendJson(res, 200, { url: `/artifacts/${pdfRel.replace(/\\/g, '/')}` })
        })
        .catch(async () => {
          try {
            await generateReportPdf(jobId, job.report)
            sendJson(res, 200, { url: `/artifacts/${pdfRel.replace(/\\/g, '/')}` })
          } catch (err) {
            sendJson(res, 500, { error: 'Failed to generate PDF.' })
          }
        })

      return
    }

    const downloadMatch = pathname.match(/^\/api\/design-audit\/([a-f0-9-]+)\/pdf\/download$/i)
    if (downloadMatch) {
      const jobId = downloadMatch[1]
      const job = auditJobs.get(jobId)
      if (!job) {
        sendJson(res, 404, { error: 'Audit job not found.' })
        return
      }

      if (job.status !== 'completed' || !job.report) {
        sendJson(res, 409, { error: 'Report not available yet. Wait for job to complete.' })
        return
      }

      const pdfPath = path.join(ARTIFACTS_ROOT, jobId, 'report.pdf')

      const streamPdf = async () => {
        try {
          await fsPromises.access(pdfPath)
        } catch {
          await generateReportPdf(jobId, job.report)
        }

        try {
          const stat = await fsPromises.stat(pdfPath)
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="design-audit-${jobId}.pdf"`,
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*',
          })

          const stream = fs.createReadStream(pdfPath)
          stream.on('error', () => {
            if (!res.headersSent) {
              sendJson(res, 500, { error: 'Failed to stream PDF.' })
            } else {
              res.destroy()
            }
          })
          stream.pipe(res)
        } catch {
          sendJson(res, 500, { error: 'Failed to stream PDF.' })
        }
      }

      streamPdf().catch(() => sendJson(res, 500, { error: 'Failed to stream PDF.' }))
      return
    }

    const match = pathname.match(/^\/api\/design-audit\/([a-f0-9-]+)$/i)

    if (!match) {
      sendJson(res, 404, { error: 'Audit job not found.' })
      return
    }

    const job = auditJobs.get(match[1])
    if (!job) {
      sendJson(res, 404, { error: 'Audit job not found.' })
      return
    }

    sendAuditJobState(res, job)
    return
  }

  if (req.method === 'POST' && req.url === '/api/chat') {
    readBody(req)
      .then((body) => {
        const message = typeof body.message === 'string' ? body.message.trim() : ''

        if (!message) {
          sendJson(res, 400, { error: 'Message is required.' })
          return
        }

        if (looksLikeUrl(message)) {
          const job = createAuditJob(message)
          startAuditJob(job)

          sendJson(res, 202, {
            mode: 'audit-started',
            reply: `Started website design audit for ${message}.`,
            jobId: job.id,
            status: job.status,
          })
          return
        }

        sendJson(res, 200, {
          mode: 'text',
          reply: 'Send a website URL and I will generate a full UI/UX design audit report with screenshot evidence.',
        })
      })
      .catch((error) => {
        sendJson(res, 400, { error: error.message })
      })

    return
  }

  sendJson(res, 404, { error: 'Not found.' })
})

server.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`)
})
