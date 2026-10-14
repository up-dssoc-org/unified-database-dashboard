/**
 * Saves the analytics board as one file — PNG, SVG or PDF.
 *
 * The board is not screenshotted. It is redrawn as a single SVG document: each
 * card becomes a flat panel holding its title, its description and either its
 * figure or a copy of the D3 chart already on screen. A chart is copied rather
 * than redrawn, so the export shows exactly what the board shows, at the same
 * column widths. The card controls (drag handle, ordering, edit, remove) are
 * left out. Everything else comes from that one SVG:
 *
 *   SVG — the document itself, with its fonts embedded so it looks the same
 *         wherever it is opened.
 *   PNG — that document drawn onto a canvas at up to twice its size.
 *   PDF — the PNG's pixels on one page sized to the board, written by hand
 *         below so the export needs no PDF library.
 *
 * The card content is read from the rendered cards, not from the board entries,
 * so this module relies on DataPointCard's class names: `.name-text`,
 * `.point-note`, `.state`, `.cell-figure`, `.cell-caption`, and the chart
 * markup inside `.chart` / `.donut`. Renaming one of those means updating it here.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

export const EXPORT_FORMATS = [
  {
    value: 'png',
    label: 'PNG',
    note: 'An image, good for slides and chat.',
    mime: 'image/png',
  },
  {
    value: 'svg',
    label: 'SVG',
    note: 'A vector image that stays sharp at any size.',
    mime: 'image/svg+xml',
  },
  {
    value: 'pdf',
    label: 'PDF',
    note: 'One page, ready to print or attach.',
    mime: 'application/pdf',
  },
]

const PAGE_MARGIN = 32
const ROW_GAP = 16
const HEADER_GAP = 24

// The largest canvas every browser in use will allocate (Safari's cap is about
// 16.7M pixels). A tall board is drawn at a lower scale rather than failing.
const MAX_SCALE = 2
const MAX_CANVAS_AREA = 16_000_000

/**
 * Type sizes in px, copied from the board's own CSS (rem = 16px) so the export
 * looks like the board. `line` is the line height.
 */
const TYPE = {
  headerTitle: { size: 25.6, weight: 600, line: 32, family: 'sans', fill: 'ink' },
  headerSub: { size: 14.4, weight: 400, line: 21, family: 'sans', fill: 'slate' },
  headerDate: { size: 12.5, weight: 400, line: 32, family: 'mono', fill: 'slate' },
  title: { size: 16.8, weight: 600, line: 22, family: 'sans', fill: 'ink' },
  note: { size: 12.48, weight: 400, line: 17, family: 'sans', fill: 'slate' },
  state: { size: 13.76, weight: 400, line: 20, family: 'sans', fill: 'slate' },
  error: { size: 13.76, weight: 400, line: 20, family: 'sans', fill: 'ink' },
  figure: { size: 46.4, weight: 500, line: 46.4, family: 'mono', fill: 'ink' },
  caption: { size: 13.12, weight: 400, line: 19.7, family: 'sans', fill: 'slate' },
  legend: { size: 13.6, weight: 400, line: 20.4, family: 'sans', fill: 'ink' },
  legendCount: { size: 12.48, weight: 400, line: 20.4, family: 'mono', fill: 'slate' },
}

/**
 * Builds the file and starts its download.
 *
 * `header` is `null` for none, or `{ title, subtitle, date }`, where `date` is a
 * boolean asking for today's date on the right of the title.
 */
export async function exportBoard(board, { format, header = null }) {
  const spec = EXPORT_FORMATS.find((f) => f.value === format)
  if (!spec) throw new Error(`Unknown export format: ${format}`)

  // Text is wrapped by measuring it, and that is only right once the web fonts
  // the board uses have loaded.
  await document.fonts?.ready

  const { svg, width, height } = composeBoard(board, header)

  const fonts = await embeddedFonts()
  if (fonts) svg.prepend(svgEl('style', {}, fonts))

  const markup = new XMLSerializer().serializeToString(svg)

  let blob
  if (format === 'svg') {
    blob = new Blob(['<?xml version="1.0" encoding="UTF-8"?>\n', markup], { type: spec.mime })
  } else {
    const canvas = await rasterize(markup, width, height)
    blob =
      format === 'png'
        ? await canvasBlob(canvas, spec.mime)
        : await canvasPdf(canvas, width, height, header?.title)
  }

  download(blob, fileName(header, format))
}

/* ------------------------------------------------------------------------ */
/* Composition                                                               */
/* ------------------------------------------------------------------------ */

/** The board, redrawn as one SVG document the width of the board plus margins. */
function composeBoard(board, header) {
  const theme = readTheme()
  const boardRect = board.getBoundingClientRect()
  const width = Math.ceil(boardRect.width + PAGE_MARGIN * 2)

  // No `xmlns` attribute: the element is already in the SVG namespace, and
  // XMLSerializer declares it on its own.
  const svg = svgEl('svg', { width })
  const background = svgEl('rect', { x: 0, y: 0, width, fill: theme.surface })
  svg.append(background)

  let y = PAGE_MARGIN
  if (header) y = drawHeader(svg, header, theme, width) + HEADER_GAP

  // Cards keep their on-screen columns. Cards sharing a grid row share a top
  // on screen, and that is how rows are found; each row is then as tall as its
  // tallest card here, since card heights are recomputed for the export.
  const cards = [...board.children].filter((child) => child.matches('.point'))
  let rowScreenTop = null
  let rowHeight = 0

  for (const card of cards) {
    const laid = layoutCard(card, theme)
    const screen = card.getBoundingClientRect()

    if (rowScreenTop === null || Math.abs(screen.top - rowScreenTop) > 2) {
      if (rowScreenTop !== null) y += rowHeight + ROW_GAP
      rowScreenTop = screen.top
      rowHeight = 0
    }

    const g = svgEl('g', {
      transform: `translate(${PAGE_MARGIN + (screen.left - boardRect.left)},${y})`,
    })
    laid.draw(g)
    svg.append(g)
    rowHeight = Math.max(rowHeight, laid.height)
  }

  const height = Math.ceil(y + rowHeight + PAGE_MARGIN)
  svg.setAttribute('height', height)
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
  background.setAttribute('height', height)

  return { svg, width, height }
}

/**
 * Title, optional subtitle and optional date across the top, closed by a maroon
 * rule. Returns the y the board starts below.
 */
function drawHeader(svg, header, theme, width) {
  const x = PAGE_MARGIN
  const innerW = width - PAGE_MARGIN * 2
  let y = PAGE_MARGIN

  const date = header.date
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long' }).format(new Date())
    : ''
  // The date sits on the title's first line, so the title wraps short of it.
  const dateRoom = date ? measure(date, TYPE.headerDate, theme) + 24 : 0

  const titleLines = wrap(header.title, TYPE.headerTitle, innerW - dateRoom, theme)
  drawLines(svg, titleLines, TYPE.headerTitle, theme, x, y)
  if (date) drawLines(svg, [date], TYPE.headerDate, theme, x + innerW, y, 'end')
  y += titleLines.length * TYPE.headerTitle.line

  if (header.subtitle) {
    y += 4
    const subLines = wrap(header.subtitle, TYPE.headerSub, innerW, theme)
    drawLines(svg, subLines, TYPE.headerSub, theme, x, y)
    y += subLines.length * TYPE.headerSub.line
  }

  y += 14
  svg.append(svgEl('rect', { x, y, width: innerW, height: 2, fill: theme.maroon }))
  return y + 2
}

/**
 * One card as a stack of blocks, each `{ height, draw(g, x, y) }`. Measuring
 * everything before drawing anything is what lets a row be sized to its
 * tallest card.
 */
function layoutCard(card, theme) {
  const style = getComputedStyle(card)
  const padX = parseFloat(style.paddingLeft) || 0
  const padY = parseFloat(style.paddingTop) || 0
  const border = parseFloat(style.borderLeftWidth) || 0
  const width = card.getBoundingClientRect().width
  const innerW = card.clientWidth - padX - (parseFloat(style.paddingRight) || 0)

  const blocks = []

  // A card mid-rename has an input where its name was; its draft is what shows.
  const renaming = card.querySelector('.name-input')
  const title =
    textIn(card, '.name-text') ||
    renaming?.value.trim() ||
    renaming?.placeholder ||
    'Data point'
  blocks.push(textBlock(title, TYPE.title, innerW, theme))

  const note = textIn(card, '.point-note')
  if (note) {
    blocks.push(spacer(2.4))
    blocks.push(textBlock(note, TYPE.note, innerW, theme))
  }

  blocks.push(spacer(14.4))
  blocks.push(...bodyBlocks(card, innerW, theme))

  const contentH = blocks.reduce((sum, b) => sum + b.height, 0)
  const height = Math.ceil(border * 2 + padY * 2 + contentH)

  return {
    height,
    draw(g) {
      g.append(
        svgEl('rect', {
          x: 0.5,
          y: 0.5,
          width: width - 1,
          height: height - 1,
          rx: 2,
          fill: theme.surface,
          stroke: theme.rule,
          'stroke-width': 1,
        })
      )
      let y = border + padY
      for (const block of blocks) {
        block.draw(g, border + padX, y)
        y += block.height
      }
    },
  }
}

/** Whatever the card is showing below its heading. */
function bodyBlocks(card, innerW, theme) {
  const state = card.querySelector('.state')
  if (state) {
    const text = state.textContent.trim()
    return [
      state.classList.contains('notice')
        ? errorBlock(text, innerW, theme)
        : textBlock(text, TYPE.state, innerW, theme),
    ]
  }

  const figure = card.querySelector('.cell-figure')
  if (figure) {
    const caption = textIn(card, '.cell-caption')
    return [
      spacer(6.4),
      textBlock(figure.textContent.trim(), TYPE.figure, innerW, theme),
      ...(caption ? [spacer(5.6), textBlock(caption, TYPE.caption, innerW, theme)] : []),
      spacer(9.6),
    ]
  }

  const donut = card.querySelector('.donut')
  if (donut) return [donutBlock(donut, innerW, theme)]

  const chart = card.querySelector('.chart > svg')
  if (chart) return [chartBlock(chart)]

  return []
}

const spacer = (height) => ({ height, draw() {} })

function textBlock(text, type, maxWidth, theme) {
  const lines = wrap(text, type, maxWidth, theme)
  return {
    height: lines.length * type.line,
    draw: (g, x, y) => drawLines(g, lines, type, theme, x, y),
  }
}

/** A failed query, drawn the way `.notice` draws it: maroon bar, inset text. */
function errorBlock(text, maxWidth, theme) {
  const padX = 14.4
  const padY = 11.2
  const lines = wrap(text, TYPE.error, maxWidth - padX - 3, theme)
  const height = lines.length * TYPE.error.line + padY * 2
  return {
    height,
    draw(g, x, y) {
      g.append(svgEl('rect', { x, y, width: 3, height, fill: theme.maroon }))
      drawLines(g, lines, TYPE.error, theme, x + 3 + padX, y + padY)
    },
  }
}

/** A bar or line chart: a copy of the SVG on screen, at its on-screen size. */
function chartBlock(source) {
  const { width, height } = source.getBoundingClientRect()
  const copy = copyChart(source)
  return {
    height,
    draw(g, x, y) {
      copy.setAttribute('x', x)
      copy.setAttribute('y', y)
      copy.setAttribute('width', width)
      copy.setAttribute('height', height)
      g.append(copy)
    },
  }
}

/**
 * A pie chart: the ring is copied, but its legend is HTML on screen and so is
 * redrawn here. Like the board's flex layout, the legend sits beside the ring
 * when there is room for it and wraps below when there is not.
 */
function donutBlock(donut, innerW, theme) {
  const ring = donut.querySelector('svg')
  const size = ring ? ring.getBoundingClientRect().width : 0
  const gap = 22.4
  const minLegend = 176

  const items = [...donut.querySelectorAll('.legend li')].map((li) => ({
    color: getComputedStyle(li.querySelector('.swatch')).backgroundColor,
    name: textIn(li, '.name'),
    count: textIn(li, '.count'),
  }))

  const rowH = TYPE.legend.line + 6.4
  const legendH = items.length * rowH
  const beside = innerW - size - gap >= minLegend
  const legendW = beside ? innerW - size - gap : innerW
  const height = beside ? Math.max(size, legendH) : size + (items.length ? gap + legendH : 0)
  const copy = ring ? copyChart(ring) : null

  return {
    height,
    draw(g, x, y) {
      const ringY = beside ? y + (height - size) / 2 : y
      if (copy) {
        copy.setAttribute('x', x)
        copy.setAttribute('y', ringY)
        g.append(copy)
      }

      const lx = beside ? x + size + gap : x
      let ly = beside ? y + (height - legendH) / 2 : y + size + gap

      items.forEach((item, i) => {
        const textTop = ly + 3.2
        const countW = measure(item.count, TYPE.legendCount, theme)
        const nameRoom = legendW - 9 - 8 - 8 - countW
        g.append(
          svgEl('rect', {
            x: lx,
            y: textTop + TYPE.legend.line / 2 - 4.5,
            width: 9,
            height: 9,
            rx: 1,
            fill: item.color,
          })
        )
        drawLines(g, [fit(item.name, TYPE.legend, nameRoom, theme)], TYPE.legend, theme, lx + 17, textTop)
        drawLines(g, [item.count], TYPE.legendCount, theme, lx + legendW, textTop, 'end')
        ly += rowH
        if (i < items.length - 1) {
          g.append(svgEl('rect', { x: lx, y: ly - 1, width: legendW, height: 1, fill: theme.rule }))
        }
      })
    },
  }
}

// What a chart needs once it leaves the page. The charts are styled by scoped
// CSS and CSS variables, neither of which travels with a copied node, so the
// resolved values are written onto each element of the copy.
const PAINT_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-opacity', 'opacity']
const TEXT_PROPS = ['font-family', 'font-size', 'font-weight', 'font-variant-numeric']

function copyChart(source) {
  const copy = source.cloneNode(true)
  const from = [source, ...source.querySelectorAll('*')]
  const to = [copy, ...copy.querySelectorAll('*')]

  from.forEach((node, i) => {
    const computed = getComputedStyle(node)
    const props = node.tagName.toLowerCase() === 'text' ? [...PAINT_PROPS, ...TEXT_PROPS] : PAINT_PROPS
    to[i].setAttribute('style', props.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(';'))
    to[i].removeAttribute('class')
  })

  copy.removeAttribute('role')
  copy.removeAttribute('aria-label')
  return copy
}

/* ------------------------------------------------------------------------ */
/* Text                                                                      */
/* ------------------------------------------------------------------------ */

let measurer = null

function measure(text, type, theme) {
  measurer ??= document.createElement('canvas').getContext('2d')
  measurer.font = `${type.weight} ${type.size}px ${theme[type.family]}`
  return measurer.measureText(text).width
}

/**
 * Breaks text into lines no wider than `maxWidth`. Words longer than a whole
 * line (descriptions can carry long field paths) are split mid-word, as
 * `overflow-wrap: anywhere` does on the board.
 */
function wrap(text, type, maxWidth, theme) {
  const fits = (s) => measure(s, type, theme) <= maxWidth
  const lines = []
  let line = ''

  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (fits(next)) {
      line = next
      continue
    }
    if (line) lines.push(line)

    let rest = word
    while (rest.length > 1 && !fits(rest)) {
      let cut = rest.length - 1
      while (cut > 1 && !fits(rest.slice(0, cut))) cut--
      lines.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    line = rest
  }

  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

/** Shortens one line to fit, ending it with an ellipsis. */
function fit(text, type, maxWidth, theme) {
  if (measure(text, type, theme) <= maxWidth) return text
  let cut = text.length
  while (cut > 0 && measure(`${text.slice(0, cut)}…`, type, theme) > maxWidth) cut--
  return `${text.slice(0, cut)}…`
}

function drawLines(parent, lines, type, theme, x, top, anchor = 'start') {
  lines.forEach((line, i) => {
    parent.append(
      svgEl(
        'text',
        {
          x,
          y: baseline(top + i * type.line, type),
          'font-family': theme[type.family],
          'font-size': type.size,
          'font-weight': type.weight,
          fill: theme[type.fill],
          'text-anchor': anchor === 'start' ? null : anchor,
          style: type.family === 'mono' ? 'font-variant-numeric:tabular-nums' : null,
        },
        line
      )
    )
  })
}

/**
 * Where the baseline falls in a line box, as CSS places it. IBM Plex rises
 * 1.025em above its baseline and drops 0.275em below it, and CSS centres that
 * 1.3em on the line height.
 */
const baseline = (top, type) => top + (type.line - type.size * 1.3) / 2 + type.size * 1.025

/* ------------------------------------------------------------------------ */
/* Output                                                                    */
/* ------------------------------------------------------------------------ */

async function rasterize(markup, width, height) {
  const scale = Math.min(MAX_SCALE, Math.sqrt(MAX_CANVAS_AREA / (width * height)))
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))

  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = () => reject(new Error('The dashboard could not be drawn as an image.'))
      image.src = url
    })

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return canvas
  } finally {
    URL.revokeObjectURL(url)
  }
}

function canvasBlob(canvas, type) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The image could not be encoded.'))),
      type
    )
  })
}

/**
 * A one-page PDF holding the canvas as a lossless image. The page is the
 * board's size at 96 CSS px to the inch, so it prints at the scale it shows on
 * screen.
 *
 * The pixels go in as raw RGB, deflated with the browser's own
 * `CompressionStream` — its 'deflate' output is the zlib stream PDF's
 * FlateDecode expects.
 */
async function canvasPdf(canvas, widthPx, heightPx, title) {
  const { width: w, height: h } = canvas
  const rgba = canvas.getContext('2d').getImageData(0, 0, w, h).data
  const rgb = new Uint8Array(w * h * 3)
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]
    rgb[j + 1] = rgba[i + 1]
    rgb[j + 2] = rgba[i + 2]
  }
  const pixels = await deflate(rgb)

  const pageW = (widthPx * 0.75).toFixed(2)
  const pageH = (heightPx * 0.75).toFixed(2)
  const encoder = new TextEncoder()
  const content = encoder.encode(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`)

  const parts = []
  const offsets = []
  let length = 0
  const push = (chunk) => {
    const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
    parts.push(bytes)
    length += bytes.length
  }
  const object = (n, dict, stream) => {
    offsets[n] = length
    push(`${n} 0 obj\n${dict}\n`)
    if (stream) {
      push('stream\n')
      push(stream)
      push('\nendstream\n')
    }
    push('endobj\n')
  }

  // The second line's non-ASCII bytes mark the file as binary to any tool that checks.
  push('%PDF-1.4\n%âãÏÓ\n')
  object(1, '<< /Type /Catalog /Pages 2 0 R >>')
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  object(
    3,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      '/Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'
  )
  object(4, `<< /Length ${content.length} >>`, content)
  object(
    5,
    `<< /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceRGB ` +
      `/BitsPerComponent 8 /Filter /FlateDecode /Length ${pixels.length} >>`,
    pixels
  )
  object(6, `<< /Title ${pdfText(title || 'Analytics dashboard')} /Producer (DSSOC Membership) >>`)

  const xref = length
  push(
    `xref\n0 ${offsets.length}\n0000000000 65535 f \n` +
      offsets
        .slice(1)
        .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
        .join('')
  )
  push(`trailer\n<< /Size ${offsets.length} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  return new Blob(parts, { type: 'application/pdf' })
}

async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** A PDF text string as UTF-16BE hex, which holds any character a title can. */
function pdfText(text) {
  let hex = 'FEFF'
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, '0')
  return `<${hex.toUpperCase()}>`
}

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  // Revoked on the next turn rather than at once: some browsers start the
  // download asynchronously and would otherwise find the URL gone.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** `<header-title>-YYYY-MM-DD.<ext>`, or `analytics-dashboard-…` without a header. */
function fileName(header, format) {
  const slug =
    (header?.title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'analytics-dashboard'
  const now = new Date()
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-')
  return `${slug}-${stamp}.${format}`
}

/* ------------------------------------------------------------------------ */
/* Theme and fonts                                                           */
/* ------------------------------------------------------------------------ */

/** The board's colours and fonts, read from the CSS variables in styles.css. */
function readTheme() {
  const root = getComputedStyle(document.documentElement)
  const v = (name, fallback) => root.getPropertyValue(name).trim() || fallback
  return {
    ink: v('--ink', '#16191a'),
    slate: v('--slate', '#4c5654'),
    rule: v('--rule', '#d9dcd6'),
    surface: v('--surface', '#ffffff'),
    maroon: v('--maroon', '#7b1113'),
    sans: v('--font', "'IBM Plex Sans', system-ui, sans-serif"),
    mono: v('--figure', "'IBM Plex Mono', ui-monospace, monospace"),
  }
}

let fontCss = null

/**
 * The IBM Plex faces as `@font-face` rules with the font files inlined.
 *
 * An SVG drawn into a canvas cannot load fonts from the page, and a saved SVG
 * opened elsewhere cannot either, so the fonts have to travel inside it. Only
 * the Latin subset is kept, which is all the board's labels need. If Google
 * Fonts cannot be reached, the export still works with the fallback fonts, and
 * the next export tries again.
 */
function embeddedFonts() {
  fontCss ??= loadFonts().catch(() => {
    fontCss = null
    return ''
  })
  return fontCss
}

async function loadFonts() {
  const link = document.querySelector(
    'link[rel="stylesheet"][href*="fonts.googleapis.com"][href*="IBM+Plex"]'
  )
  if (!link) return ''

  const css = await (await fetch(link.href)).text()
  const faces = css.match(/@font-face\s*{[^}]*}/g) ?? []
  const latin = faces.filter((face) => /unicode-range:[^;]*U\+0000-00FF/i.test(face))
  const chosen = latin.length ? latin : faces.filter((face) => !/unicode-range/i.test(face))

  const inlined = await Promise.all(
    chosen.map(async (face) => {
      const src = face.match(/url\(\s*['"]?([^'")]+)['"]?\s*\)/)?.[1]
      if (!src) return ''
      const response = await fetch(src)
      if (!response.ok) throw new Error(`Font request failed: ${response.status}`)
      return face.replace(/url\([^)]*\)/, `url(${await dataUrl(await response.blob())})`)
    })
  )
  return inlined.join('\n')
}

function dataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

/** `document.createElementNS` with attributes (null ones skipped) and optional text. */
function svgEl(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, value)
  }
  if (text !== undefined) node.textContent = text
  return node
}

const textIn = (root, selector) => root.querySelector(selector)?.textContent.trim() ?? ''
