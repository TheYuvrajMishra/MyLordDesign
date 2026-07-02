const fs = require('fs/promises')
const path = require('path')
const { randomUUID } = require('crypto')
const puppeteer = require('puppeteer')

const ARTIFACTS_ROOT = path.join(__dirname, '..', 'artifacts')

const VIEWPORTS = [
  {
    id: 'desktop',
    width: 1440,
    height: 900,
    isMobile: false,
    deviceScaleFactor: 1,
    hasTouch: false,
  },
  {
    id: 'mobile',
    width: 390,
    height: 844,
    isMobile: true,
    deviceScaleFactor: 2,
    hasTouch: true,
  },
]

const SECTION_SELECTORS = [
  { id: 'header', label: 'Header', selector: 'header' },
  { id: 'navigation', label: 'Navigation', selector: 'nav' },
  { id: 'main', label: 'Main content', selector: 'main' },
  { id: 'footer', label: 'Footer', selector: 'footer' },
  { id: 'form', label: 'Primary form', selector: 'form' },
  { id: 'cards', label: 'Card pattern', selector: '[class*="card" i], article' },
  { id: 'cta', label: 'Call to action', selector: 'button, [role="button"], a[href]' },
]

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function looksLikeUrl(value) {
  return /^https?:\/\//i.test(value) || /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(value)
}

function normalizeUrl(input) {
  const value = String(input || '').trim()
  if (!value) {
    throw new Error('URL is required for website audit.')
  }

  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const parsed = new URL(withProtocol)

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Only http and https URLs are supported.')
  }

  return parsed.toString()
}

function artifactUrl(jobId, fileName) {
  return `/artifacts/${jobId}/${fileName}`
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function disableMotion(page) {
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.setAttribute('data-audit-style', 'true')
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        scroll-behavior: auto !important;
      }
    `
    document.head.appendChild(style)
  })
}

async function handleCookieBanner(page) {
  const selectors = [
    'button',
    '[role="button"]',
    'a',
    'input[type="button"]',
    'input[type="submit"]',
  ]

  await page.evaluate((candidateSelectors) => {
    const terms = ['accept', 'agree', 'allow all', 'ok', 'got it', 'consent']

    const nodes = candidateSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)))

    for (const node of nodes) {
      const text = (node.textContent || node.getAttribute('aria-label') || '').toLowerCase().trim()
      if (terms.some((term) => text.includes(term))) {
        node.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      }
    }
  }, selectors)
}

async function autoScroll(page) {
  await page.evaluate(async () => {
    const totalHeight = document.body.scrollHeight
    const step = Math.max(300, Math.floor(window.innerHeight * 0.75))
    let position = 0

    while (position < totalHeight) {
      window.scrollTo(0, position)
      await new Promise((resolve) => setTimeout(resolve, 120))
      position += step
    }

    window.scrollTo(0, 0)
  })
}

async function waitForStability(page) {
  try {
    await page.waitForNetworkIdle({ idleTime: 800, timeout: 14000 })
  } catch {
    await waitMs(1200)
  }
}

async function safeCaptureElement(page, section, viewportId, outputDir) {
  const element = await page.$(section.selector)
  if (!element) {
    return null
  }

  const box = await element.boundingBox()
  if (!box || box.width < 40 || box.height < 40) {
    return null
  }

  const fileName = `${viewportId}-${section.id}.png`
  const screenshotPath = path.join(outputDir, fileName)

  await page.screenshot({
    path: screenshotPath,
    clip: {
      x: Math.max(0, box.x),
      y: Math.max(0, box.y),
      width: Math.max(1, Math.floor(box.width)),
      height: Math.max(1, Math.floor(box.height)),
    },
  })

  return {
    id: `${viewportId}-${section.id}`,
    type: section.id,
    label: `${section.label} (${viewportId})`,
    viewport: viewportId,
    path: artifactUrl(path.basename(outputDir), fileName),
  }
}

function rankEntries(entries, limit = 8) {
  return [...entries]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
}

async function extractMetrics(page, viewportId) {
  return page.evaluate((mode) => {
    const rgbToArray = (rgbStr) => {
      const match = rgbStr.match(/\d+/g)
      return match ? match.slice(0, 4).map(Number) : null
    }

    const isNearColor = (rgb, targetRgb, threshold = 20) => {
      if (!rgb || !targetRgb) return false
      for (let i = 0; i < 3; i++) {
        if (Math.abs(rgb[i] - targetRgb[i]) > threshold) return false
      }
      return true
    }

    const normalizeColor = (value) => {
      if (!value) return null
      const str = String(value).toLowerCase()
      
      if (str.includes('transparent') || str.includes('rgba(0,0,0,0)') || str.includes('rgba(255,255,255,0)')) {
        return null
      }
      
      const rgb = rgbToArray(str)
      if (!rgb) return null
      
      const [r, g, b, a] = rgb
      
      if (a !== undefined && a < 0.1) return null
      
      const isNearWhite = isNearColor(rgb, [255, 255, 255], 25)
      const isNearBlack = isNearColor(rgb, [0, 0, 0], 25)
      if (isNearWhite || isNearBlack) return null
      
      return `rgb(${r}, ${g}, ${b})`
    }

    const all = Array.from(document.querySelectorAll('*'))
    const sample = all.slice(0, 2000)

    const textElements = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,button,span'))
      .filter((node) => (node.textContent || '').trim().length > 0)
      .slice(0, 2500)

    const addCount = (map, key) => {
      if (!key) return
      map[key] = (map[key] || 0) + 1
    }

    const colorMap = {}
    const bgMap = {}
    const borderMap = {}
    const fontFamilyMap = {}
    const fontSizeMap = {}

    const colorCache = {}
    const bgCache = {}
    const borderCache = {}
    
    const addCountWithNormalize = (map, cache, key) => {
      if (!key) return
      const normalized = normalizeColor(key)
      if (!normalized) return
      
      if (cache[normalized]) {
        addCount(map, normalized)
      } else {
        cache[normalized] = true
        addCount(map, normalized)
      }
    }

    for (const node of textElements) {
      const styles = getComputedStyle(node)
      addCount(fontFamilyMap, styles.fontFamily)
      addCount(fontSizeMap, styles.fontSize)
      addCountWithNormalize(colorMap, colorCache, styles.color)
      addCountWithNormalize(bgMap, bgCache, styles.backgroundColor)
      addCountWithNormalize(borderMap, borderCache, styles.borderColor)
    }

    const buttonNodes = Array.from(document.querySelectorAll('button, [role="button"], a[class*="btn" i], input[type="submit"]'))
    const formNodes = Array.from(document.querySelectorAll('form'))

    const bodyText = (document.body?.innerText || '').toLowerCase()

    const countKeyword = (patterns) => patterns.reduce((acc, pattern) => acc + (bodyText.match(pattern) || []).length, 0)

    const trustSignals = countKeyword([/testimonial/g, /trusted/g, /security/g, /privacy/g, /reviews?/g, /client/g])
    const conversionSignals = countKeyword([/sign up/g, /get started/g, /book demo/g, /buy now/g, /contact sales/g, /start free/g])

    let animatedNodes = 0
    for (const node of sample) {
      const styles = getComputedStyle(node)
      if (styles.animationName !== 'none' || styles.transitionDuration !== '0s') {
        animatedNodes += 1
      }
    }

    const imageNodes = Array.from(document.images)
    const missingAltImages = imageNodes.filter((img) => !img.alt || !img.alt.trim()).length
    const emptyLinks = Array.from(document.querySelectorAll('a')).filter((node) => !(node.textContent || '').trim()).length
    const unlabeledButtons = buttonNodes.filter((node) => {
      const label = (node.textContent || node.getAttribute('aria-label') || '').trim()
      return label.length === 0
    }).length

    const hasHorizontalOverflow = document.documentElement.scrollWidth > window.innerWidth + 4
    const headingCount = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).length

    const cards = document.querySelectorAll('[class*="card" i], article, [class*="tile" i]').length
    const navCount = document.querySelectorAll('nav').length
    const stickyElements = sample.filter((node) => {
      const position = getComputedStyle(node).position
      return position === 'sticky' || position === 'fixed'
    }).length

    const flexContainers = sample.filter((node) => getComputedStyle(node).display.includes('flex')).length
    const gridContainers = sample.filter((node) => getComputedStyle(node).display.includes('grid')).length

    function parseToRGB(input) {
      try {
        const el = document.createElement('div')
        el.style.color = input
        el.style.display = 'none'
        document.body.appendChild(el)
        const cs = getComputedStyle(el).color
        document.body.removeChild(el)
        const m = cs.match(/\d+/g)
        return m ? m.slice(0, 3).map(Number) : null
      } catch (e) {
        return null
      }
    }

    function colorDistance(a, b) {
      return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
    }

    function mergeColors(map, threshold = 28) {
      const merged = []
      for (const [label, count] of Object.entries(map || {})) {
        const rgb = parseToRGB(label)
        if (!rgb) continue
        let placed = false
        for (const group of merged) {
          if (colorDistance(group.rgb, rgb) <= threshold) {
            group.count += count
            placed = true
            break
          }
        }
        if (!placed) merged.push({ rgb, count })
      }

      const out = {}
      for (const g of merged) {
        const key = `rgb(${g.rgb[0]}, ${g.rgb[1]}, ${g.rgb[2]})`
        out[key] = (out[key] || 0) + g.count
      }
      return out
    }

    const normalizedText = mergeColors(colorMap, 28)
    const normalizedBg = mergeColors(bgMap, 30)
    const normalizedBorder = mergeColors(borderMap, 30)

    return {
      viewport: mode,
      title: document.title || '',
      description: document.querySelector('meta[name="description"]')?.content || '',
      headingCount,
      cards,
      navCount,
      stickyElements,
      flexContainers,
      gridContainers,
      buttonCount: buttonNodes.length,
      formCount: formNodes.length,
      missingAltImages,
      emptyLinks,
      unlabeledButtons,
      hasHorizontalOverflow,
      trustSignals,
      conversionSignals,
      animatedNodes,
      contentLength: (document.body?.innerText || '').trim().length,
      typography: {
        fontFamilies: fontFamilyMap,
        fontSizes: fontSizeMap,
      },
      colors: {
        text: normalizedText,
        backgrounds: normalizedBg,
        borders: normalizedBorder,
      },
    }
  }, viewportId)
}

function buildSection({
  id,
  title,
  score,
  summary,
  findings,
  recommendations,
  severity,
  impact,
  evidenceIds,
}) {
  return {
    id,
    title,
    score: clampScore(score),
    summary,
    findings,
    recommendations,
    severity,
    impact,
    evidenceIds,
  }
}

function topEntries(map, limit) {
  const entries = Object.entries(map || {}).map(([label, count]) => ({ label, count }))
  return rankEntries(entries, limit)
}

function isVisibleColor(value) {
  if (!value) return false
  const str = String(value).toLowerCase()
  return !['transparent', 'rgba(0,0,0,0)', 'rgba(255,255,255,0)'].includes(str)
}

function generateReport(url, auditData) {
  const desktop = auditData.metrics.find((item) => item.viewport === 'desktop')
  const mobile = auditData.metrics.find((item) => item.viewport === 'mobile')

  const fontScale = topEntries(desktop?.typography?.fontSizes || {}, 6)
  const families = topEntries(desktop?.typography?.fontFamilies || {}, 4)
  const colorTokens = topEntries(desktop?.colors?.text || {}, 6)
  const surfaceTokens = topEntries(desktop?.colors?.backgrounds || {}, 8).filter((item) => isVisibleColor(item.label))
  const accentTokens = topEntries(desktop?.colors?.borders || {}, 8).filter((item) => isVisibleColor(item.label))

  const paletteScheme = {
    summary: `Detected ${colorTokens.length} dominant text colors, ${surfaceTokens.length} surface colors, and ${accentTokens.length} accent/border colors.`,
    roles: [
      { role: 'Primary text', value: colorTokens[0]?.label || 'rgb(24, 24, 27)' },
      { role: 'Secondary text', value: colorTokens[1]?.label || colorTokens[0]?.label || 'rgb(63, 63, 70)' },
      { role: 'Primary surface', value: surfaceTokens[0]?.label || 'rgb(255, 255, 255)' },
      { role: 'Secondary surface', value: surfaceTokens[1]?.label || surfaceTokens[0]?.label || 'rgb(244, 244, 245)' },
      { role: 'Accent / CTA', value: accentTokens[0]?.label || colorTokens[2]?.label || colorTokens[0]?.label || 'rgb(39, 39, 42)' },
    ],
    textPalette: colorTokens.map((item) => ({ value: item.label, count: item.count })),
    surfacePalette: surfaceTokens.map((item) => ({ value: item.label, count: item.count })),
    accentPalette: accentTokens.map((item) => ({ value: item.label, count: item.count })),
  }

  const accessibilityPenalty =
    (desktop?.missingAltImages || 0) * 1.8 +
    (desktop?.emptyLinks || 0) * 2 +
    (desktop?.unlabeledButtons || 0) * 2.2

  const responsivenessPenalty =
    (desktop?.hasHorizontalOverflow ? 18 : 0) + (mobile?.hasHorizontalOverflow ? 24 : 0)

  const visualHierarchyScore = clampScore(62 + Math.min(20, (desktop?.headingCount || 0) * 1.2) + Math.min(12, (desktop?.cards || 0)))
  const typographyScore = clampScore(55 + Math.min(25, fontScale.length * 4) + (families.length <= 3 ? 10 : 2))
  const colorScore = clampScore(60 + Math.min(20, colorTokens.length * 3) - Math.max(0, colorTokens.length - 10) * 2)
  const layoutScore = clampScore(58 + Math.min(16, (desktop?.gridContainers || 0) / 3) + Math.min(10, (desktop?.flexContainers || 0) / 8))
  const accessibilityScore = clampScore(92 - accessibilityPenalty)
  const responsiveScore = clampScore(88 - responsivenessPenalty)
  const interactionScore = clampScore(56 + Math.min(20, (desktop?.buttonCount || 0) * 0.8) + Math.min(10, (desktop?.formCount || 0) * 2))
  const conversionScore = clampScore(52 + Math.min(35, (desktop?.conversionSignals || 0) * 5 + (desktop?.trustSignals || 0) * 2))
  const consistencyScore = clampScore(60 + (families.length <= 3 ? 16 : 6) + (fontScale.length <= 8 ? 10 : 2))
  const componentScore = clampScore(57 + Math.min(18, (desktop?.cards || 0) * 1.1) + Math.min(12, (desktop?.buttonCount || 0) * 0.5))
  const perceivedPerformanceScore = clampScore(64 + ((desktop?.animatedNodes || 0) < 120 ? 14 : 4))
  const modernityScore = clampScore(60 + Math.min(16, (desktop?.gridContainers || 0) / 4) + Math.min(12, (desktop?.stickyElements || 0) * 3))
  const uxFrictionScore = clampScore(88 - (desktop?.emptyLinks || 0) * 2 - (mobile?.hasHorizontalOverflow ? 16 : 0) - Math.max(0, (desktop?.formCount || 0) - 3) * 3)
  const competitiveScore = clampScore((modernityScore + visualHierarchyScore + conversionScore + consistencyScore) / 4)

  const scoreValues = [
    visualHierarchyScore,
    typographyScore,
    colorScore,
    layoutScore,
    accessibilityScore,
    responsiveScore,
    interactionScore,
    conversionScore,
    consistencyScore,
    componentScore,
    perceivedPerformanceScore,
    modernityScore,
  ]

  const overallScore = clampScore(scoreValues.reduce((acc, value) => acc + value, 0) / scoreValues.length)

  const sectionEvidence = (type) =>
    auditData.evidence.filter((item) => item.type === type || item.type === 'full').map((item) => item.id)

  const sections = [
    buildSection({
      id: 'brand-identity',
      title: 'Brand and Design Identity Evaluation',
      score: consistencyScore,
      summary: `Visual identity appears ${families.length <= 3 ? 'focused' : 'fragmented'} across typography and component styling.`,
      findings: [
        `Detected ${families.length} dominant font families in desktop rendering.`,
        `Top textual color tokens show ${colorTokens.length} recurring values.`,
        `Navigation appears ${desktop?.navCount || 0} time(s), indicating ${desktop?.navCount === 1 ? 'a singular primary pattern' : 'multiple navigation patterns'}.`,
      ],
      recommendations: [
        'Limit production typography to 2-3 font families with explicit role assignments.',
        'Map recurring color tokens into a semantic design-token set (text, surface, action, status).',
      ],
      severity: families.length > 3 ? 'medium' : 'low',
      impact: 'high',
      evidenceIds: sectionEvidence('header'),
    }),
    buildSection({
      id: 'visual-hierarchy',
      title: 'Visual Hierarchy Analysis',
      score: visualHierarchyScore,
      summary: 'Hierarchy strength is evaluated from heading structure density, card segmentation, and above-the-fold clarity.',
      findings: [
        `Heading nodes detected: ${desktop?.headingCount || 0}.`,
        `Card-like content clusters detected: ${desktop?.cards || 0}.`,
        `Sticky/fixed framing elements found: ${desktop?.stickyElements || 0}.`,
      ],
      recommendations: [
        'Ensure the first viewport communicates one dominant value proposition and one primary CTA.',
        'Reduce competing visual weights in parallel content blocks.',
      ],
      severity: visualHierarchyScore < 70 ? 'medium' : 'low',
      impact: 'high',
      evidenceIds: sectionEvidence('main'),
    }),
    buildSection({
      id: 'typography',
      title: 'Typography Analysis',
      score: typographyScore,
      summary: `Typography scale shows ${fontScale.length} frequent font-size steps in desktop mode.`,
      findings: [
        `Most common families: ${families.map((item) => `${item.label} (${item.count})`).join(' | ') || 'none captured'}.`,
        `Most common sizes: ${fontScale.map((item) => `${item.label} (${item.count})`).join(' | ') || 'none captured'}.`,
      ],
      recommendations: [
        'Constrain heading/body/caption scale into a documented modular ratio.',
        'Enforce readable body line length and minimum line-height for dense sections.',
      ],
      severity: typographyScore < 70 ? 'medium' : 'low',
      impact: 'medium',
      evidenceIds: sectionEvidence('main'),
    }),
    buildSection({
      id: 'color-psychology',
      title: 'Color Psychology Analysis',
      score: colorScore,
      summary: `Detected ${colorTokens.length} recurring text color values; palette cohesion influences trust and conversion confidence.`,
      findings: [
        `Top text colors: ${colorTokens.map((item) => `${item.label} (${item.count})`).join(' | ') || 'none captured'}.`,
        `Animation-intense nodes: ${desktop?.animatedNodes || 0}, which can alter perceived visual calmness.`,
      ],
      recommendations: [
        'Codify one high-attention CTA hue and reserve it for conversion-critical actions.',
        'Audit contrast for secondary text against all major surface colors.',
      ],
      severity: colorScore < 68 ? 'medium' : 'low',
      impact: 'medium',
      evidenceIds: sectionEvidence('cta'),
    }),
    buildSection({
      id: 'layout-grid',
      title: 'Layout and Grid Analysis',
      score: layoutScore,
      summary: `Layout structure uses ${desktop?.gridContainers || 0} grid and ${desktop?.flexContainers || 0} flex containers in sampled nodes.`,
      findings: [
        `Desktop overflow detected: ${desktop?.hasHorizontalOverflow ? 'yes' : 'no'}.`,
        `Mobile overflow detected: ${mobile?.hasHorizontalOverflow ? 'yes' : 'no'}.`,
      ],
      recommendations: [
        'Define consistent max-widths and gutter scales per breakpoint tier.',
        'Use grid for macro-layout and flex for local alignment to improve predictability.',
      ],
      severity: layoutScore < 70 ? 'medium' : 'low',
      impact: 'high',
      evidenceIds: sectionEvidence('full'),
    }),
    buildSection({
      id: 'accessibility',
      title: 'Accessibility Review',
      score: accessibilityScore,
      summary: 'Accessibility quality is scored using image alt coverage and interactive control labeling checks.',
      findings: [
        `Images without useful alt text: ${desktop?.missingAltImages || 0}.`,
        `Empty links detected: ${desktop?.emptyLinks || 0}.`,
        `Buttons without accessible label text: ${desktop?.unlabeledButtons || 0}.`,
      ],
      recommendations: [
        'Add meaningful alt text for informative images and empty alt for decorative assets.',
        'Ensure every interactive control has visible or aria-based labeling.',
      ],
      severity: accessibilityScore < 70 ? 'high' : accessibilityScore < 85 ? 'medium' : 'low',
      impact: 'high',
      evidenceIds: sectionEvidence('main'),
    }),
    buildSection({
      id: 'mobile-responsiveness',
      title: 'Mobile Responsiveness Review',
      score: responsiveScore,
      summary: 'Responsiveness is measured by mobile viewport rendering behavior and overflow indicators.',
      findings: [
        `Mobile viewport configured at ${VIEWPORTS[1].width}x${VIEWPORTS[1].height}.`,
        `Mobile horizontal overflow: ${mobile?.hasHorizontalOverflow ? 'detected' : 'not detected'}.`,
      ],
      recommendations: [
        'Prioritize tap targets, spacing rhythm, and vertical content flow in mobile-first QA.',
        'Validate all CTAs and forms in narrow viewport states.',
      ],
      severity: responsiveScore < 72 ? 'high' : responsiveScore < 86 ? 'medium' : 'low',
      impact: 'high',
      evidenceIds: auditData.evidence.filter((item) => item.viewport === 'mobile').map((item) => item.id),
    }),
    buildSection({
      id: 'interaction-design',
      title: 'Interaction Design Review',
      score: interactionScore,
      summary: `Detected ${desktop?.buttonCount || 0} interactive controls and ${desktop?.animatedNodes || 0} animated nodes.`,
      findings: [
        `Forms detected: ${desktop?.formCount || 0}.`,
        `Sticky/fixed interaction anchors: ${desktop?.stickyElements || 0}.`,
      ],
      recommendations: [
        'Normalize hover, focus, and pressed states across all interactive controls.',
        'Ensure motion supports feedback clarity without delaying user intent.',
      ],
      severity: interactionScore < 65 ? 'high' : interactionScore < 80 ? 'medium' : 'low',
      impact: 'medium',
      evidenceIds: sectionEvidence('cta'),
    }),
    buildSection({
      id: 'conversion-optimization',
      title: 'Conversion Optimization Review',
      score: conversionScore,
      summary: `Conversion language indicators found: ${desktop?.conversionSignals || 0}; trust indicators found: ${desktop?.trustSignals || 0}.`,
      findings: [
        `Primary CTA opportunities detected: ${desktop?.buttonCount || 0}.`,
        `Trust-oriented copy patterns detected: ${desktop?.trustSignals || 0}.`,
      ],
      recommendations: [
        'Align hero CTA, mid-page CTA, and footer CTA messaging to one conversion path.',
        'Strengthen social proof and risk-reversal messaging near commitment actions.',
      ],
      severity: conversionScore < 65 ? 'high' : conversionScore < 80 ? 'medium' : 'low',
      impact: 'high',
      evidenceIds: sectionEvidence('cta'),
    }),
    buildSection({
      id: 'ux-friction',
      title: 'UX Friction Analysis',
      score: uxFrictionScore,
      summary: 'Friction score combines accessibility defects, overflow behavior, and interaction dead-ends.',
      findings: [
        `Empty link nodes: ${desktop?.emptyLinks || 0}.`,
        `Unlabeled buttons: ${desktop?.unlabeledButtons || 0}.`,
        `Mobile overflow status: ${mobile?.hasHorizontalOverflow ? 'overflow detected' : 'no overflow detected'}.`,
      ],
      recommendations: [
        'Remove dead-end click targets and ensure every interaction yields visible feedback.',
        'Resolve horizontal overflow and spacing collisions in narrow breakpoints.',
      ],
      severity: uxFrictionScore < 65 ? 'high' : uxFrictionScore < 80 ? 'medium' : 'low',
      impact: 'high',
      evidenceIds: sectionEvidence('main'),
    }),
    buildSection({
      id: 'consistency-component-maturity',
      title: 'Consistency and Component-System Maturity',
      score: componentScore,
      summary: 'Component maturity is inferred from repeated card/button patterns and cross-section visual reuse.',
      findings: [
        `Card-like modules detected: ${desktop?.cards || 0}.`,
        `Button-like controls detected: ${desktop?.buttonCount || 0}.`,
      ],
      recommendations: [
        'Convert repeated UI blocks into standardized component variants with token-driven theming.',
        'Audit variant sprawl and remove one-off button/card treatments.',
      ],
      severity: componentScore < 70 ? 'medium' : 'low',
      impact: 'medium',
      evidenceIds: sectionEvidence('cards'),
    }),
    buildSection({
      id: 'performance-modernity',
      title: 'Performance Perception and Modernity Alignment',
      score: clampScore((perceivedPerformanceScore + modernityScore) / 2),
      summary: 'Perceived performance is influenced by motion load, content density, and structural modern UI patterns.',
      findings: [
        `Animated/transitioned nodes sampled: ${desktop?.animatedNodes || 0}.`,
        `Primary content text length: ${desktop?.contentLength || 0} characters.`,
      ],
      recommendations: [
        'Use progressive reveal only where it supports comprehension, not decoration.',
        'Balance visual modernity with motion restraint and predictable loading states.',
      ],
      severity: perceivedPerformanceScore < 70 ? 'medium' : 'low',
      impact: 'medium',
      evidenceIds: sectionEvidence('full'),
    }),
    buildSection({
      id: 'competitive-perception',
      title: 'Competitive-Quality Perception',
      score: competitiveScore,
      summary: 'Competitive quality is inferred from modern layout patterns, hierarchy clarity, and conversion confidence.',
      findings: [
        `Modernity score: ${modernityScore}/100.`,
        `Hierarchy score: ${visualHierarchyScore}/100.`,
        `Conversion score: ${conversionScore}/100.`,
      ],
      recommendations: [
        'Benchmark hero clarity and CTA confidence against category leaders quarterly.',
        'Prioritize visual differentiation in key conversion zones without sacrificing usability.',
      ],
      severity: competitiveScore < 68 ? 'high' : competitiveScore < 82 ? 'medium' : 'low',
      impact: 'high',
      evidenceIds: sectionEvidence('full'),
    }),
  ]

  const strengths = sections
    .filter((section) => section.score >= 80)
    .slice(0, 4)
    .map((section) => `${section.title}: ${section.summary}`)

  const weaknesses = sections
    .filter((section) => section.score < 70)
    .slice(0, 4)
    .map((section) => `${section.title}: ${section.findings[0]}`)

  const prioritizedRecommendations = sections
    .slice()
    .sort((a, b) => a.score - b.score)
    .slice(0, 6)
    .map((section) => section.recommendations[0])

  return {
    executiveSummary: `Audit completed on ${url}. Overall score ${overallScore}/100. Key opportunities center on ${sections
      .slice()
      .sort((a, b) => a.score - b.score)
      .slice(0, 3)
      .map((item) => item.title.toLowerCase())
      .join(', ')}.`,
    overallScore,
    strengths,
    weaknesses,
    prioritizedRecommendations,
    sections,
    evidence: auditData.evidence,
    colorPaletteScheme: paletteScheme,
    metadata: {
      targetUrl: url,
      analyzedAt: new Date().toISOString(),
      durationMs: auditData.durationMs,
      viewportModes: VIEWPORTS.map((item) => item.id),
    },
    diagnostics: {
      desktop,
      mobile,
      typographyTop: {
        families,
        scale: fontScale,
      },
      colorTop: colorTokens,
    },
  }
}

async function captureForViewport(page, viewport, outputDir, onProgress, attempt = 0) {
  try {
    onProgress(`Configuring ${viewport.id} viewport`, 18 + (viewport.id === 'mobile' ? 32 : 0))
    await page.setViewport(viewport)
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
    onProgress(`Waiting for ${viewport.id} network idle`, 24 + (viewport.id === 'mobile' ? 32 : 0))
    await waitForStability(page)
    onProgress(`Handling consent UI for ${viewport.id}`, 28 + (viewport.id === 'mobile' ? 32 : 0))
    await handleCookieBanner(page)
    onProgress(`Scrolling ${viewport.id} page for lazy content`, 32 + (viewport.id === 'mobile' ? 32 : 0))
    await autoScroll(page)
    onProgress(`Stabilizing ${viewport.id} animations`, 36 + (viewport.id === 'mobile' ? 32 : 0))
    await waitForStability(page)
    await disableMotion(page)

    const evidence = []

    const fullName = `${viewport.id}-full.png`
    const foldName = `${viewport.id}-above-fold.png`

    onProgress(`Capturing ${viewport.id} full-page screenshot`, 40 + (viewport.id === 'mobile' ? 32 : 0))
    await page.screenshot({ path: path.join(outputDir, fullName), fullPage: true })
    onProgress(`Capturing ${viewport.id} above-the-fold screenshot`, 44 + (viewport.id === 'mobile' ? 32 : 0))
    await page.screenshot({
      path: path.join(outputDir, foldName),
      clip: { x: 0, y: 0, width: viewport.width, height: viewport.height },
    })

    evidence.push({
      id: `${viewport.id}-full`,
      type: 'full',
      label: `Full page (${viewport.id})`,
      viewport: viewport.id,
      path: artifactUrl(path.basename(outputDir), fullName),
    })

    evidence.push({
      id: `${viewport.id}-above-fold`,
      type: 'above-fold',
      label: `Above the fold (${viewport.id})`,
      viewport: viewport.id,
      path: artifactUrl(path.basename(outputDir), foldName),
    })

    for (const section of SECTION_SELECTORS) {
      onProgress(`Capturing ${viewport.id} ${section.label.toLowerCase()}`, 48 + (viewport.id === 'mobile' ? 32 : 0))
      const capture = await safeCaptureElement(page, section, viewport.id, outputDir)
      if (capture) {
        evidence.push(capture)
      }
    }

    onProgress(`Extracting ${viewport.id} UI/UX metrics`, 56 + (viewport.id === 'mobile' ? 32 : 0))
    const metrics = await extractMetrics(page, viewport.id)

    return { evidence, metrics }
  } catch (error) {
    if (attempt < 1) {
      onProgress(`Retrying ${viewport.id} capture after transient failure`, 52 + (viewport.id === 'mobile' ? 32 : 0))
      await waitMs(600)
      return captureForViewport(page, viewport, outputDir, onProgress, attempt + 1)
    }

    throw error
  }
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || undefined,
  })
}

async function runDesignAudit(inputUrl, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {}
  const normalizedUrl = normalizeUrl(inputUrl)
  const jobId = options.jobId || randomUUID()
  const outputDir = path.join(ARTIFACTS_ROOT, jobId)

  onProgress('Preparing audit workspace', 5)
  await ensureDirectory(outputDir)

  const startedAt = Date.now()
  let browser
  const evidence = []
  const metrics = []

  try {
    onProgress('Launching headless Chromium', 10)
    browser = await launchBrowser()

    for (const viewport of VIEWPORTS) {
      onProgress(`Opening ${viewport.id} rendering context`, viewport.id === 'desktop' ? 14 : 46)
      const page = await browser.newPage()

      try {
        onProgress(`Loading target URL in ${viewport.id} mode`, viewport.id === 'desktop' ? 16 : 48)
        await page.goto(normalizedUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        })

        const result = await captureForViewport(page, viewport, outputDir, onProgress)
        evidence.push(...result.evidence)
        metrics.push(result.metrics)
      } finally {
        await page.close()
      }
    }

    const durationMs = Date.now() - startedAt
    onProgress('Generating consultant-quality audit report', 88)
    const report = {
      ...generateReport(normalizedUrl, { evidence, metrics, durationMs }),
      jobId,
    }

    await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
    onProgress('Audit report finalized', 100)

    return {
      jobId,
      report,
    }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

module.exports = {
  looksLikeUrl,
  normalizeUrl,
  runDesignAudit,
  ARTIFACTS_ROOT,
  generateReportPdf,
}


async function renderReportHtml(report, jobId) {
  const safe = (str) => String(str || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const screenshots = (report.evidence || []).map((ev) => {
    const src = ev.path
    return `<figure style="margin:0 0 12px"><img src="${src}" style="width:100%;height:auto;border-radius:8px"/><figcaption style="font-size:12px;color:#666">${safe(ev.label)} • ${safe(ev.viewport)}</figcaption></figure>`
  }).join('\n')

  const palette = (report.colorPaletteScheme && report.colorPaletteScheme.roles) ? report.colorPaletteScheme.roles.map((r) => `
    <div style="display:inline-block;margin:6px;padding:6px;border-radius:6px;border:1px solid #ddd;width:120px;text-align:center">
      <div style="height:40px;border-radius:6px;background:${r.value};margin-bottom:6px;border:1px solid rgba(0,0,0,0.06)"></div>
      <div style="font-size:12px">${safe(r.role)}</div>
      <div style="font-size:11px;color:#444">${safe(r.value)}</div>
    </div>
  `).join('\n') : ''

  return `
  <!doctype html>
  <html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Design Audit Report</title>
    <style>
      body{font-family:Inter,system-ui,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111;margin:20px}
      .header{display:flex;justify-content:space-between;align-items:center}
      .meta{color:#666;font-size:13px}
      .section{margin-top:18px}
      .grid{display:flex;flex-wrap:wrap;gap:12px}
      h1{font-size:20px;margin:0}
    </style>
  </head>
  <body>
    <div class="header">
      <div>
        <h1>Design Audit — ${safe(report.metadata?.targetUrl)}</h1>
        <div class="meta">Analyzed: ${safe(report.metadata?.analyzedAt)} • Score: ${safe(report.overallScore)}</div>
      </div>
    </div>

    <div class="section">
      <h2 style="font-size:16px;margin:6px 0">Executive summary</h2>
      <p style="color:#333">${safe(report.executiveSummary)}</p>
    </div>

    <div class="section">
      <h2 style="font-size:16px;margin:6px 0">Color palette</h2>
      <div class="grid">${palette}</div>
    </div>

    <div class="section">
      <h2 style="font-size:16px;margin:6px 0">Screenshots</h2>
      ${screenshots}
    </div>

    <div class="section">
      <h2 style="font-size:16px;margin:6px 0">Sections</h2>
      ${report.sections.map(s => `<div style="margin-bottom:8px"><strong>${safe(s.title)}</strong><div style="color:#444">${safe(s.summary)}</div></div>`).join('')}
    </div>
  </body>
  </html>
  `
}

async function generateReportPdf(jobId, report) {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  try {
    const page = await browser.newPage()
    const html = await renderReportHtml(report, jobId)
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const outPath = path.join(ARTIFACTS_ROOT, jobId, 'report.pdf')
    await fs.mkdir(path.dirname(outPath), { recursive: true })
    await page.pdf({ path: outPath, format: 'A4', printBackground: true, margin: { top: '20mm', bottom: '20mm', left: '12mm', right: '12mm' } })
    await page.close()
    return outPath
  } finally {
    await browser.close()
  }
}
