export type Edition = 'old' | 'new'
export type Language = 'hy' | 'ru'
export type Status = 'changed' | 'added' | 'removed' | 'moved' | 'unchanged' | 'unmapped'
export type UnitKind = 'preamble' | 'article' | 'unnumbered'

export interface Paragraph {
  text: string
  level: 'paragraph' | 'point' | 'subpoint'
  number: string | null
}

export interface Unit {
  id: string
  edition: Edition
  kind: UnitKind
  number: string | null
  title: string
  heading: string
  section: string | null
  chapterId: string | null
  chapterNumber: string | null
  chapterTitle: string | null
  text: string
  paragraphs: Paragraph[]
  source: string
}

export type UnitSummary = Omit<Unit, 'text' | 'paragraphs'>

export interface Chapter { id: string; number: string; title: string; heading: string }
export interface DocumentData { edition: Edition; source: string; chapters: Chapter[]; units: Unit[] }

export interface Mapping {
  old: string | null
  new: string[]
  status: Exclude<Status, 'unmapped'>
  evidence: string
  scope?: 'partial'
}

const chapterPattern = /^(?:Գ\s*Լ\s*ՈՒ\s*Խ|Г\s*Л\s*А\s*В\s*А)\s+(\d+)[․.։:]?\s+(.+)$/iu
const articlePattern = /^(?:Հոդված|Статья)\s+(\d+(?:[.-]\d+)*)(?:[.․։])(?:\s+(.*))?$/u
const markerPattern = /^(\d+|[ա-ֆа-яё])([.)․։])\s+/u

export function normalize(text: string) {
  return text.normalize('NFC').replace(/\s+/gu, ' ').trim()
}

export function parseDocument(
  markdown: string,
  edition: Edition,
  source: string,
  pages: { articlePages?: Record<string, number>; preamblePage?: number | null } = {},
): DocumentData {
  const chapters: Chapter[] = []
  const units: Unit[] = []
  const ids = new Set<string>()
  let chapter: Chapter | undefined
  let section: string | null = null
  let pending: Omit<Unit, 'paragraphs' | 'text'> | undefined
  let body: string[] = []
  let unnumbered = 0

  function flush() {
    if (!pending) return
    if (ids.has(pending.id)) throw new Error(`Duplicate provision ${pending.id}`)
    if (body.length === 0) throw new Error(`Empty provision ${pending.id}`)
    ids.add(pending.id)
    const paragraphs: Paragraph[] = body.map((text) => {
      const marker = text.match(markerPattern)
      return { text, number: marker?.[1] ?? null, level: marker ? marker[2] === ')' ? 'subpoint' : 'point' : 'paragraph' }
    })
    units.push({ ...pending, paragraphs, text: body.join('\n\n') })
    body = []
    pending = undefined
  }

  function begin(kind: UnitKind, heading = '', number: string | null = null, title = '') {
    const page = number ? pages.articlePages?.[number] : kind === 'preamble' ? pages.preamblePage : null
    const id = kind === 'article' ? `article-${number}` : kind === 'preamble' ? kind : `provision-${++unnumbered}`
    pending = {
      id: `${edition}-${id}`, edition, kind, heading, number, title, section,
      chapterId: chapter?.id ?? null, chapterNumber: chapter?.number ?? null, chapterTitle: chapter?.title ?? null,
      source: page ? `${source}#page=${page}` : source,
    }
  }

  for (const block of markdown.trim().split(/\r?\n[\t ]*\r?\n+/u).filter(Boolean)) {
    const heading = block.match(/^(#{1,4}) ([^\r\n]+)$/u)
    if (!heading) {
      if (block.startsWith('#')) throw new Error(`Invalid Markdown heading: ${block.slice(0, 120)}`)
      if (!pending) begin(chapter || section ? 'unnumbered' : 'preamble')
      body.push(block)
      continue
    }
    flush()
    const [, marker, title] = heading
    if (marker === '#') {
      section = title
      chapter = undefined
    } else if (marker === '##') {
      const match = title.match(chapterPattern)
      if (!match) throw new Error(`Invalid chapter heading: ${title}`)
      chapter = { id: `${edition}-chapter-${match[1]}`, number: match[1], title: match[2], heading: title }
      if (chapters.some(({ id }) => id === chapter?.id)) throw new Error(`Duplicate chapter: ${title}`)
      chapters.push(chapter)
    } else if (marker === '###') {
      const match = title.match(articlePattern)
      if (!match) throw new Error(`Invalid article heading: ${title}`)
      begin('article', title, match[1], match[2] ?? '')
    } else {
      begin('unnumbered', title, null, title)
    }
  }
  flush()
  if (!units.length) throw new Error(`Empty document: ${edition}`)
  return { edition, source, chapters, units }
}

export function mappingIndex(mappings: Mapping[], old: UnitSummary[], draft: UnitSummary[]) {
  const index = new Map<string, Mapping>()
  const oldIds = new Set(old.map(({ id }) => id))
  const newIds = new Set(draft.map(({ id }) => id))
  for (const mapping of mappings) {
    const { old, new: targets, status, evidence, scope } = mapping
    const paired = status === 'changed' || status === 'moved' || status === 'unchanged'
    const validShape = paired ? old && targets.length > 0
      : status === 'added' ? !old && targets.length > 0
        : status === 'removed' && old && targets.length === 0
    if (!validShape || !evidence.trim() || (scope && scope !== 'partial') || (scope && status !== 'changed') ||
      (old && !oldIds.has(old)) || targets.some((id) => !newIds.has(id))) {
      throw new Error(`Invalid article mapping: ${JSON.stringify(mapping)}`)
    }
    for (const id of old ? [old, ...targets] : targets) {
      if (index.has(id)) throw new Error(`Duplicate mapping for ${id}`)
      index.set(id, mapping)
    }
  }
  return index
}

export function statistics(units: UnitSummary[], index: Map<string, Mapping>) {
  const totals: Record<Status, number> = { added: 0, removed: 0, changed: 0, moved: 0, unchanged: 0, unmapped: 0 }
  for (const unit of units) {
    const status = index.get(unit.id)?.status ?? 'unmapped'
    if (status === 'added' || status === 'removed' ||
      (unit.kind === 'article' && (status === 'unmapped' || unit.edition === 'old'))) totals[status]++
  }
  return totals
}
