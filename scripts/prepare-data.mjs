import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { mappingIndex, parseDocument, statistics } from '../src/documents.ts'
import { documentLines, lineDiff } from '../src/diffs.ts'

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))
const sha = (value) => createHash('sha256').update(value).digest('hex')
const report = await readJson('content/extraction-report.json')
const { mappings, sourceSha256 } = await readJson('content/article-mappings.json')
for (const [source, hash] of Object.entries(sourceSha256)) {
  if (hash !== report[source]?.sourceSha256) {
    throw new Error(`Review article mappings against the new ${source} PDF before publication.`)
  }
}

const armenian = await build('hy')
await build('ru', armenian)

async function build(language, reference) {
  const old = await prepare('old', language)
  const draft = await prepare('new', language)
  if (reference) {
    for (const [index, doc] of [old, draft].entries()) {
      const original = reference[index]
      if (doc.units.map(({ id }) => id).join() !== original.units.map(({ id }) => id).join()) {
        throw new Error(`Translation structure differs from the Armenian source: ${doc.source}`)
      }
    }
  }
  const index = mappingIndex(mappings, old.units, draft.units)
  const oldLines = documentLines(old)
  const newLines = documentLines(draft)
  const oldChapter = oldLines.findIndex((line) => line.kind === 'chapter')
  const newChapter = newLines.findIndex((line) => line.kind === 'chapter')
  const first = lineDiff(oldLines.slice(0, oldChapter), newLines.slice(0, newChapter), true)
  const rest = lineDiff(oldLines.slice(oldChapter), newLines.slice(newChapter), false, index)

  for (const [side, original] of [['old', oldLines], ['new', newLines]]) {
    const restored = [...first, ...rest].flatMap((row) => row[side] ? [row[side]] : [])
    if (restored.length !== original.length || restored.some((line, i) => line !== original[i])) {
      throw new Error(`Diff lost or reordered ${language} ${side} lines`)
    }
  }

  const chunks = [first]
  for (let i = 0; i < rest.length; i += 24) chunks.push(rest.slice(i, i + 24))
  const locations = {}
  const changes = []
  for (const [chunk, rows] of chunks.entries()) {
    for (const [row, value] of rows.entries()) {
      const location = { chunk, row }
      for (const line of [value.old, value.new]) {
        if (line?.unit) locations[line.unit] ??= location
      }
      if (!value.equal) changes.push(location)
    }
  }
  const extraction = Object.fromEntries(['old', 'new'].map((edition) => {
    const data = report[stem(edition, language)]
    return [edition, { pages: data.pages, review: data.issues.length > 0 }]
  }))

  const directory = `generated/${language}`
  await rm(`${directory}/diffs`, { recursive: true, force: true })
  await mkdir(`${directory}/diffs`, { recursive: true })
  await mkdir('generated/documents', { recursive: true })
  const documents = {}
  for (const doc of [old, draft]) {
    await writeFile(`generated/documents/${stem(doc.edition, language)}.json`, JSON.stringify(doc, null, 2) + '\n')
    const bodies = {}
    documents[doc.edition] = {
      ...doc,
      units: doc.units.map(({ paragraphs, text, ...metadata }) => {
        bodies[metadata.id] = paragraphs
        return metadata
      }),
    }
    await writeFile(`${directory}/text-${doc.edition}.json`, JSON.stringify(bodies))
  }
  await writeFile(`${directory}/dataset.json`, JSON.stringify({
    documents, mappings, totals: statistics([...old.units, ...draft.units], index),
    chunkCount: chunks.length, locations, changes, extraction,
  }))
  await Promise.all(chunks.map((rows, i) => writeFile(`${directory}/diffs/${i}.json`, JSON.stringify(rows))))
  console.log(`Prepared ${language}: ${old.units.length + draft.units.length} provisions and ${chunks.length} diff sections`)
  return [old, draft]
}

function stem(edition, language) {
  return language === 'ru' ? `${edition}_ru` : edition
}

async function prepare(edition, language) {
  const name = stem(edition, language)
  const source = `sources/${name}.pdf`
  const details = report[name]
  const markdown = await readFile(`content/${name}.md`, 'utf8')
  if (sha(markdown) !== details.markdownSha256) {
    throw new Error(`Extraction report is out of date for ${name}. Run npm run extract.`)
  }
  if (sha(await readFile(source)) !== details.sourceSha256) {
    throw new Error(`Source PDF changed: ${source}. Run npm run extract and review article mappings.`)
  }
  const document = parseDocument(markdown, edition, source, details)
  if (document.units.filter((unit) => unit.kind === 'article').length !== details.articles ||
    document.chapters.length !== details.chapters) {
    throw new Error(`The Markdown structure differs from its extraction report: ${name}`)
  }
  return document
}
