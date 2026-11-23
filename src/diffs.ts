import { diffArrays } from 'diff'
import { normalize, type DocumentData, type Mapping } from './documents.ts'

export type LineKind = 'section' | 'chapter' | 'heading' | 'text' | 'preamble'
export interface Line { text: string; kind: LineKind; unit?: string; no?: number }
export interface Part { text: string; changed: boolean }
export interface Row {
  old: Line | null
  new: Line | null
  oldParts?: Part[]
  newParts?: Part[]
  equal: boolean
}

function tokens(text: string): string[] {
  // Armenian intra-word question, stress and exclamation marks belong to the word.
  return text.match(/[\p{L}\p{M}\p{N}֊՞՛՜]+|\s+|[^\p{L}\p{M}\p{N}\s]/gu) ?? []
}

export function wordDiff(before: string, after: string): [Part[], Part[]] {
  const old = tokens(before)
  const draft = tokens(after)
  const left: Part[] = []
  const right: Part[] = []
  let l = 0
  let r = 0
  for (const change of diffArrays(old, draft, { comparator: (a, b) => normalize(a) === normalize(b) })) {
    const length = change.value.length
    if (!change.added) {
      left.push({ text: old.slice(l, l + length).join(''), changed: !!change.removed })
      l += length
    }
    if (!change.removed) {
      right.push({ text: draft.slice(r, r + length).join(''), changed: !!change.added })
      r += length
    }
  }
  return [left, right]
}

export function documentLines(doc: DocumentData): Line[] {
  const lines: Line[] = []
  const chapters = new Map(doc.chapters.map((chapter) => [chapter.id, chapter]))
  let lastSection: string | null = null
  let lastChapter: string | null = null
  for (const unit of doc.units) {
    if (unit.section && unit.section !== lastSection) lines.push({ text: unit.section, kind: 'section' })
    lastSection = unit.section
    if (unit.chapterId && unit.chapterId !== lastChapter) {
      lines.push({ text: chapters.get(unit.chapterId)!.heading, kind: 'chapter' })
    }
    lastChapter = unit.chapterId
    if (unit.kind === 'preamble') lines.push({ text: '', kind: 'preamble', unit: unit.id })
    if (unit.heading) lines.push({ text: unit.heading, kind: 'heading', unit: unit.id })
    for (const paragraph of unit.paragraphs) lines.push({ text: paragraph.text, kind: 'text', unit: unit.id })
  }
  return lines.map((line, index) => ({ ...line, no: index + 1 }))
}

function makeRow(old: Line | null, draft: Line | null, equal = false): Row {
  if (old && draft && !equal) {
    const [oldParts, newParts] = wordDiff(old.text, draft.text)
    return { old, new: draft, equal, oldParts, newParts }
  }
  return { old, new: draft, equal }
}

function signature(line: Line) {
  const exact = normalize(line.text)
  const content = line.kind === 'heading' || line.kind === 'chapter'
    ? exact.replace(/^[^0-9]*[0-9]+[.․։:]?\s*/u, '')
    : exact
  const sequence = tokens(content.toLowerCase()).filter((word) => /\p{L}{3}/u.test(word))
  const words = new Set(sequence)
  const phrases = new Set(sequence.slice(1).map((word, index) => sequence[index] + ' ' + word))
  return { line, exact, words, phrases }
}

type Signature = ReturnType<typeof signature>

function overlap(first: Set<string>, second: Set<string>) {
  let count = 0
  for (const word of first) if (second.has(word)) count++
  return count
}

function matchScore(a: Signature, b: Signature, pairedArticle: boolean, reviewed?: Map<string, Mapping>) {
  if (a.line.kind !== b.line.kind) return 0
  const oldMapping = a.line.unit ? reviewed?.get(a.line.unit) : undefined
  const newMapping = b.line.unit ? reviewed?.get(b.line.unit) : undefined
  if ((oldMapping || newMapping) && oldMapping !== newMapping) return 0
  const confirmed = !!oldMapping
  if (a.exact === b.exact) return 2
  if (a.line.kind === 'heading' && confirmed) return 1.4
  const minWords = Math.min(a.words.size, b.words.size)
  const totalWords = a.words.size + b.words.size
  if (minWords >= 2 && (confirmed || 2 * minWords >= 0.4 * totalWords)) {
    const common = overlap(a.words, b.words)
    const likeness = 2 * common / totalWords
    const phraseMatch = common >= 2 && overlap(a.phrases, b.phrases) > 0
    if ((likeness >= 0.72 && common >= 2) || (likeness >= 0.4 && common >= 3 && phraseMatch) ||
      (confirmed && phraseMatch)) {
      return likeness + (phraseMatch ? 0.2 : 0) + (confirmed ? 0.2 : 0)
    }
  }
  return pairedArticle ? 0.1 : 0
}

/** Maximize the textual matches while retaining the order on both sides. */
export function lineDiff(old: Line[], draft: Line[], pairedArticle = false, reviewed?: Map<string, Mapping>): Row[] {
  const before = old.map(signature)
  const after = draft.map(signature)
  const width = after.length + 1
  const scores = new Float64Array((before.length + 1) * width)
  const choices = new Uint8Array(scores.length)

  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = draft.length - 1; j >= 0; j--) {
      const cell = i * width + j
      const leftOnly = scores[cell + width]
      const rightOnly = scores[cell + 1]
      const weight = matchScore(before[i], after[j], pairedArticle, reviewed)
      const paired = weight + scores[cell + width + 1]
      if (weight > 0 && paired >= leftOnly && paired >= rightOnly) {
        scores[cell] = paired
        choices[cell] = 1
      } else if (rightOnly > leftOnly) {
        scores[cell] = rightOnly
        choices[cell] = 2
      } else {
        scores[cell] = leftOnly
      }
    }
  }

  const rows: Row[] = []
  let i = 0
  let j = 0
  while (i < before.length || j < after.length) {
    const choice = choices[i * width + j]
    if (choice === 1) {
      const equal = before[i].exact === after[j].exact
      rows.push(makeRow(old[i++], draft[j++], equal))
    } else if (i >= old.length || (j < draft.length && choice === 2)) {
      rows.push(makeRow(null, draft[j++]))
    } else {
      rows.push(makeRow(old[i++], null))
    }
  }
  return rows
}
