import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mappingIndex, normalize, parseDocument, statistics, type Mapping } from '../src/documents'
import { documentLines, lineDiff, wordDiff } from '../src/diffs'

const oldMarkdown = `Նախաբան՝ և հայերեն։

# Բաժին Ա

## Գ Լ ՈՒ Խ 1 ՀԻՄՆԱԴՐՈՒՅԹՆԵՐ

Համարակալում չունեցող դրույթ։

### Հոդված 1. Վերնագիր

1. Հայաստանի Հանրապետությունը։

2) Երկրորդ կետը՝ առանց փոփոխության։

### Հոդված 2․ Այլ դրույթ

Տեքստ։`

const newMarkdown = `## ԳԼՈՒԽ 3․ ԴՐՈՒՅԹՆԵՐ

### Հոդված 5․ Վերնագիր

1. Հայաստանի Հանրապետությունը։

2) Երկրորդ կետը՝ առանց փոփոխության։

### Հոդված 7․ Նոր դրույթ

Նոր տեքստ։`

const old = parseDocument(oldMarkdown, 'old', 'old.pdf', { articlePages: { 1: 2 }, preamblePage: 1 })
const draft = parseDocument(newMarkdown, 'new', 'new.pdf')

describe('Armenian document parsing', () => {
  it('preserves preamble, unnumbered provisions, sections, chapter and points', () => {
    expect(old.units.map(({ kind }) => kind)).toEqual(['preamble', 'unnumbered', 'article', 'article'])
    expect(old.units[0].source).toBe('old.pdf#page=1')
    expect(old.units[2]).toMatchObject({
      id: 'old-article-1', number: '1', title: 'Վերնագիր', section: 'Բաժին Ա',
      chapterNumber: '1', chapterTitle: 'ՀԻՄՆԱԴՐՈՒՅԹՆԵՐ', source: 'old.pdf#page=2',
      paragraphs: [
        { text: '1. Հայաստանի Հանրապետությունը։', level: 'point', number: '1' },
        { text: '2) Երկրորդ կետը՝ առանց փոփոխության։', level: 'subpoint', number: '2' },
      ],
    })
    expect(draft.chapters[0].number).toBe('3')
    expect(documentLines(old)).toContainEqual(expect.objectContaining({ kind: 'section', text: 'Բաժին Ա' }))
  })

  it('preserves the exact original Unicode and whitespace in article bodies', () => {
    const body = 'Ե՞րբ  և\n նորից․'
    const document = parseDocument(`### Հոդված 1. Հարց\n\n${body}`, 'new', 'new.pdf')
    expect(document.units[0].text).toBe(body)
    expect(normalize(body)).toBe('Ե՞րբ և նորից․')
  })

  it('rejects broken headers, duplicate article IDs and empty articles', () => {
    expect(() => parseDocument('### Հոդված անհայտ\n\nՏեքստ։', 'new', 'new.pdf')).toThrow(/Invalid article/)
    expect(() => parseDocument(`${oldMarkdown}\n\n### Հոդված 2. Երկրորդ\n\nՏեքստ։`, 'old', 'old.pdf')).toThrow(/Duplicate/)
    expect(() => parseDocument('### Հոդված 1. Վերնագիր', 'old', 'old.pdf')).toThrow(/Empty provision/)
  })

  it('parses all four provided PDFs, with chapter and article boundaries preserved', () => {
    const read = (path: string) => readFileSync(new URL(`../content/${path}.md`, import.meta.url), 'utf-8')
    const a = parseDocument(read('old'), 'old', 'old.pdf')
    const b = parseDocument(read('new'), 'new', 'new.pdf')
    const c = parseDocument(read('old_ru'), 'old', 'old_ru.pdf')
    const d = parseDocument(read('new_ru'), 'new', 'new_ru.pdf')
    expect(a.units.filter(({ kind }) => kind === 'article')).toHaveLength(220)
    expect(b.units.filter(({ kind }) => kind === 'article')).toHaveLength(89)
    expect(a.units.find(({ number }) => number === '158')).toMatchObject({ title: 'Կառավարության հրաժարականը' })
    expect(a.units.find(({ number }) => number === '187')?.text).toContain('Երևանը համայնք է։')
    expect(b.units[0].paragraphs).toHaveLength(2)
    expect(c.units.map(({ id }) => id)).toEqual(a.units.map(({ id }) => id))
    expect(d.units.map(({ id }) => id)).toEqual(b.units.map(({ id }) => id))
    expect(a.units.find(({ number }) => number === '213')?.paragraphs.filter(({ level }) => level === 'point')).toHaveLength(4)
    expect(c.units.find(({ number }) => number === '213')?.text).toContain('Президен')
    expect(d.units[0].paragraphs).toHaveLength(2)
    expect(d.units.at(-1)?.text).not.toContain('ПЕРЕВОД С АРМЯНСКОГО')
    expect(c.units.at(-1)?.text).not.toContain('Настоящие изменения')
  })
})

describe('text diff', () => {
  it('highlights complete Armenian words with internal Armenian punctuation', () => {
    const before = 'Դա ո՞վ է։'
    const after = 'Դա ի՞նչ է։'
    const [left, right] = wordDiff(before, after)
    expect(left.filter(({ changed }) => changed).map(({ text }) => text)).toEqual(['ո՞վ'])
    expect(right.filter(({ changed }) => changed).map(({ text }) => text)).toEqual(['ի՞նչ'])
    expect(left.map(({ text }) => text).join('')).toBe(before)
    expect(right.map(({ text }) => text).join('')).toBe(after)
  })

  it('only normalizes comparison, retaining the original formatting on both sides', () => {
    const before = 'Մարդը  արժեք է։'
    const after = 'Մարդը\tարժեք է։'
    const rows = lineDiff([{ text: before, kind: 'text' }], [{ text: after, kind: 'text' }])
    expect(rows).toEqual([{ old: { text: before, kind: 'text' }, new: { text: after, kind: 'text' }, equal: true }])
    expect(wordDiff(before, after)[0]).toEqual([{ text: before, changed: false }])
  })

  it.each(['', '_ru'])('aligns preserved wording after renumbering in the full documents (%s)', (suffix) => {
    const read = (edition: 'old' | 'new') => {
      const path = new URL(`../content/${edition}${suffix}.md`, import.meta.url)
      return parseDocument(readFileSync(path, 'utf-8'), edition, `${edition}.pdf`)
    }
    const beforeDoc = read('old')
    const afterDoc = read('new')
    const file = new URL('../content/article-mappings.json', import.meta.url)
    const { mappings } = JSON.parse(readFileSync(file, 'utf-8')) as { mappings: Mapping[] }
    const index = mappingIndex(mappings, beforeDoc.units, afterDoc.units)
    const rows = lineDiff(documentLines(beforeDoc), documentLines(afterDoc), false, index)
    for (const [before, after] of [['old-article-1', 'new-article-2'], ['old-article-2', 'new-article-3']]) {
      const pair = rows.find((row) => row.old?.unit === before && row.new?.unit === after && row.old.kind === 'text')
      expect(pair?.oldParts?.some((part) => !part.changed && /\p{L}{3}/u.test(part.text))).toBe(true)
    }
    expect(rows.some((row) => row.old?.unit === 'old-article-1' && row.new?.unit === 'new-article-1')).toBe(false)
  })

  it('keeps every line on its original side and in its original order', () => {
    const previous = documentLines(old)
    const next = documentLines(draft)
    const rows = lineDiff(previous, next)
    expect(rows.flatMap((row) => row.old ? [row.old] : [])).toEqual(previous)
    expect(rows.flatMap((row) => row.new ? [row.new] : [])).toEqual(next)
    expect(rows.some((row) => row.old?.unit === 'old-article-2' && !row.new)).toBe(true)
    expect(rows.some((row) => row.new?.unit === 'new-article-7' && !row.old)).toBe(true)
  })
})

describe('reviewed article correspondences', () => {
  const mappings: Mapping[] = [
    { old: 'old-article-1', new: ['new-article-5'], status: 'moved', evidence: 'matching text' },
    { old: 'old-article-2', new: [], status: 'removed', evidence: 'reviewed' },
    { old: null, new: ['new-article-7'], status: 'added', evidence: 'reviewed' },
  ]
  it('uses explicit renumbering and counts only reviewed additions and removals', () => {
    const index = mappingIndex(mappings, old.units, draft.units)
    expect(index.get('old-article-1')?.new).toEqual(['new-article-5'])
    expect(index.get('new-article-5')?.status).toBe('moved')
    expect(statistics([...old.units, ...draft.units], index)).toEqual({
      moved: 1, removed: 1, added: 1, changed: 0, unchanged: 0, unmapped: 0,
    })
  })

  it('leaves unmatched articles unresolved and rejects a missing or duplicate reference', () => {
    const index = mappingIndex([], old.units, draft.units)
    expect(statistics([...old.units, ...draft.units], index)).toMatchObject({ removed: 0, added: 0, unmapped: 4 })
    expect(() => mappingIndex([...mappings, mappings[0]], old.units, draft.units)).toThrow(/Duplicate/)
    expect(() => mappingIndex([{ ...mappings[0], new: ['new-article-1'] }], old.units, draft.units)).toThrow(/Invalid/)
  })
})
