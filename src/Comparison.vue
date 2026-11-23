<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, shallowReactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mappingIndex, normalize, type Edition, type Language, type Paragraph, type UnitSummary } from './documents'
import { lineDiff, type Line, type Row } from './diffs'
import type { Dataset, Location } from './dataset'
import Icon from './components/Icon.vue'
import DiffCell from './components/DiffCell.vue'
import currentPdf from '../sources/old.pdf?url'
import oldRussianPdf from '../sources/old_ru.pdf?url'
import newRussianPdf from '../sources/new_ru.pdf?url'
import draftPdf from '../sources/new.pdf?url'
import extractionReport from '../content/extraction-report.json?url'

const { t, locale } = useI18n()
const { language, data } = defineProps<{ language: Language; data: Dataset }>()
const editions = ['old', 'new'] as const
const pdfs = language === 'hy' ? { old: currentPdf, new: draftPdf } : { old: oldRussianPdf, new: newRussianPdf }
const sourceUrls = {
  current: 'https://arlis.am/hy/acts/143723/latest',
  draft: 'https://yourconstitution.am/',
}
const documents = data.documents
const allUnits = [...documents.old.units, ...documents.new.units]
const byId = new Map(allUnits.map((unit) => [unit.id, unit]))
const mappings = mappingIndex(data.mappings, documents.old.units, documents.new.units)
const textIndex = new Map(documents.new.units.map((unit) => [unit.id, searchable([unit.heading, unit.title, unit.number].join(' '))]))
const chunks = import.meta.glob<Row[]>('../generated/*/diffs/*.json', { import: 'default' })
const cache = new Map<number, Row[]>()
const bodies = shallowReactive(new Map<Edition, Record<string, Paragraph[]>>())
const bodyLoads = new Map<Edition, Promise<void>>()
const fullTextIndex = new Map<string, string>()
const textLoaders = import.meta.glob<Record<string, Paragraph[]>>('../generated/*/text-*.json', { import: 'default' })
const summary = [
  { status: 'added', icon: 'plus' }, { status: 'removed', icon: 'minus' },
  { status: 'changed', icon: 'swap' }, { status: 'unmapped', icon: 'question' },
] as const

const mobile = window.matchMedia('(max-width: 650px)')
const layout = ref<'split' | 'unified'>(mobile.matches ? 'unified' : 'split')
const mode = ref<'git' | 'article'>('git')
const selected = ref('new-preamble')
const navOpen = ref(false)
const openChapters = ref(new Set(['new-chapter-1']))
const query = ref('')
const changedOnly = ref(false)
const hideEqual = ref(false)
const chunk = ref(0)
const diff = ref<Row[]>([])
const loading = ref(false)
const failed = ref(false)
const activeRow = ref(-1)
const target = ref('')
const copyState = ref('')
const manualLink = ref('')
const failedText = ref<Edition[]>([])
const searchLoading = computed(() => !!searchQuery.value && !bodies.has('new'))
const articleLoading = computed(() => articleEditions.value.some((edition) => !bodies.has(edition)))
const manualField = ref<HTMLInputElement>()
const workspace = ref<HTMLElement>()
const menuButton = ref<HTMLButtonElement>()
const searchField = ref<HTMLInputElement>()
const articleStatus = computed(() => mappings.get(selected.value)?.status ?? 'unmapped')
const selection = computed(() => byId.get(selected.value)!)
const draftSelection = computed(() => selection.value.edition === 'new' ? selected.value : target.value)
const mapping = computed(() => mappings.get(selected.value))
const oldUnit = computed(() => mapping.value?.old ? byId.get(mapping.value.old) : selection.value.edition === 'old' ? selection.value : undefined)
const targetOptions = computed(() => mapping.value?.new.map((id) => byId.get(id)!) ?? [])
const newUnit = computed(() => targetOptions.value.find((unit) => unit.id === target.value) ??
  (selection.value.edition === 'new' ? selection.value : undefined))
const articleEditions = computed(() => mode.value === 'article' ?
  [...new Set([oldUnit.value?.edition, newUnit.value?.edition, selection.value.edition].filter((edition): edition is Edition => !!edition))]
  : [])
const heading = computed(() => mode.value === 'article' ? selection.value.title || unitLabel(selection.value)
  : chunk.value === 0 ? t('preamble') : t('gitDiff'))
const extractionWarning = editions.some((edition) => data.extraction[edition].review)
const articleRows = computed(() => {
  if (!mapping.value) return []
  return lineDiff(articleLines(oldUnit.value), articleLines(newUnit.value), true)
})
const rows = computed(() => mode.value === 'git' ? diff.value : articleRows.value)
const displayRows = computed(() => rows.value.map((row, index) => ({ row, index })).filter(({ row }) => !hideEqual.value || !row.equal))
const currentChanges = computed(() => mode.value === 'git' ? data.changes : articleRows.value.flatMap(
  (row, index) => row.equal ? [] : [{ chunk: 0, row: index }],
))
const currentChange = computed(() => currentChanges.value.findIndex((location) =>
  location.chunk === (mode.value === 'git' ? chunk.value : 0) && location.row === activeRow.value,
))
const searchQuery = computed(() => searchable(query.value))
const navGroups = computed(() => {
  if (searchLoading.value) return []
  const doc = documents.new
  const visible = doc.units.filter((unit) => {
    const status = mappings.get(unit.id)?.status
    if (changedOnly.value && (unit.kind !== 'article' || !status || status === 'unchanged')) return false
    const text = unit.kind === 'preamble' ? searchable(unitLabel(unit)) : textIndex.get(unit.id)!
    return !searchQuery.value || text.includes(searchQuery.value) || !!fullTextIndex.get(unit.id)?.includes(searchQuery.value)
  })
  const groups = [
    { id: 'new-intro', chapter: null, units: visible.filter((unit) => !unit.chapterId) },
    ...doc.chapters.map((chapter) => ({ id: chapter.id, chapter, units: visible.filter((unit) => unit.chapterId === chapter.id) })),
  ]
  return groups.filter((group) => group.units.length)
})

function searchable(text: string) {
  return normalize(text).toLocaleLowerCase(language)
}

function unitLabel(unit: UnitSummary) {
  return unit.kind === 'preamble' ? t('preamble') : unit.number ? t('article', { number: unit.number }) : t('provision')
}

function articleLines(unit?: UnitSummary): Line[] {
  if (!unit) return []
  return [
    ...(unit.heading ? [{ kind: 'heading' as const, text: unit.heading, unit: unit.id }] : []),
    ...paragraphsFor(unit).map((paragraph) => ({ text: paragraph.text, kind: 'text' as const, unit: unit.id })),
  ]
}

function unitPdf(unit: UnitSummary) {
  const fragment = unit.source.split('#')[1]
  return pdfs[unit.edition] + (fragment ? `#${fragment}` : '')
}

function paragraphsFor(unit: UnitSummary) {
  return bodies.get(unit.edition)?.[unit.id] ?? []
}

function loadEdition(edition: Edition) {
  if (bodies.has(edition) || bodyLoads.has(edition)) return
  failedText.value = failedText.value.filter((value) => value !== edition)
  const load = textLoaders[`../generated/${language}/text-${edition}.json`]().then((content) => {
    if (edition === 'new') {
      for (const [id, paragraphs] of Object.entries(content)) {
        fullTextIndex.set(id, searchable(paragraphs.map(({ text }) => text).join(' ')))
      }
    }
    bodies.set(edition, content as Record<string, Paragraph[]>)
  }).catch(() => {
    failedText.value = [...failedText.value, edition]
  }).finally(() => {
    bodyLoads.delete(edition)
  })
  bodyLoads.set(edition, load)
}

function toggleChapter(id: string) {
  if (openChapters.value.has(id)) openChapters.value.delete(id)
  else openChapters.value.add(id)
}

function routeHash(id: string) {
  const alternate = mode.value === 'article' && id === selected.value && targetOptions.value.length > 1 &&
    target.value && target.value !== (selection.value.edition === 'new' ? id : targetOptions.value[0].id)
  return `#${mode.value}/${id}${alternate ? `/${target.value}` : ''}`
}

function readHash() {
  const match = location.hash.match(/^#(git|article)\/([a-z0-9.-]+)(?:\/([a-z0-9.-]+))?$/)
  if (!match || !byId.has(match[2])) return
  mode.value = match[1] as 'git' | 'article'
  void selectUnit(match[2], false, false)
  if (mode.value === 'article' && match[3] && targetOptions.value.some((unit) => unit.id === match[3])) {
    changeTarget(match[3], false)
  }
}

async function selectUnit(id: string, updateHash = true, scroll = true) {
  const unit = byId.get(id)
  if (!unit) return
  selected.value = id
  const found = mappings.get(id)
  target.value = unit.edition === 'new' ? id : found?.new[0] ?? ''
  const chapter = byId.get(target.value)?.chapterId
  if (chapter) openChapters.value.add(chapter)
  navOpen.value = false
  copyState.value = ''
  manualLink.value = ''
  if (updateHash) history.replaceState(null, '', routeHash(id))
  if (mode.value === 'git') {
    const position = data.locations[id]
    if (position) await goTo(position, scroll, true)
  } else {
    activeRow.value = -1
    if (scroll) {
      await nextTick()
      workspace.value?.focus({ preventScroll: true })
      workspace.value?.scrollIntoView({ block: 'start' })
    }
  }
}

function setMode(value: 'git' | 'article') {
  if (mode.value === value) return
  mode.value = value
  void selectUnit(selected.value, true, false)
}

async function loadChunk(index: number) {
  loading.value = true
  failed.value = false
  try {
    let value = cache.get(index)
    if (!value) {
      const load = chunks[`../generated/${language}/diffs/${index}.json`]
      if (!load) throw new Error('Diff section is unavailable')
      value = await load()
      cache.set(index, value)
    }
    if (chunk.value === index) diff.value = value
  } catch {
    if (chunk.value === index) failed.value = true
  } finally {
    if (chunk.value === index) loading.value = false
  }
}

async function goTo(location: Location, scroll = true, reveal = false) {
  activeRow.value = location.row
  if (mode.value === 'git') {
    chunk.value = location.chunk
    await loadChunk(location.chunk)
    if (chunk.value !== location.chunk || activeRow.value !== location.row) return
  }
  if (reveal && hideEqual.value && rows.value[location.row]?.equal) hideEqual.value = false
  if (!scroll) return
  await nextTick()
  const row = document.getElementById(`diff-row-${location.row}`)
  const element = row ?? workspace.value
  element?.focus({ preventScroll: true })
  element?.scrollIntoView({ block: 'nearest' })
}

async function jumpChange(direction: -1 | 1) {
  const cursor = activeRow.value >= 0 ? activeRow.value : direction > 0 ? -1 : Infinity
  const page = mode.value === 'git' ? chunk.value : 0
  const candidates = direction === 1 ? currentChanges.value : [...currentChanges.value].reverse()
  const next = candidates.find(({ chunk, row }) => direction > 0
    ? chunk > page || (chunk === page && row > cursor)
    : chunk < page || (chunk === page && row < cursor))
  if (next) {
    await goTo(next, false)
    await nextTick()
    document.getElementById(`diff-row-${next.row}`)?.scrollIntoView({ block: 'nearest' })
  }
}

async function turnPage(direction: -1 | 1) {
  const destination = chunk.value + direction
  if (destination < 0 || destination >= data.chunkCount) return
  await goTo({ chunk: destination, row: -1 }, false)
  workspace.value?.focus({ preventScroll: true })
  workspace.value?.scrollIntoView({ block: 'start' })
}

async function copyLink() {
  const row = mode.value === 'git' ? diff.value[activeRow.value] : undefined
  const id = row?.[selection.value.edition]?.unit ?? row?.new?.unit ?? row?.old?.unit ??
    (mode.value === 'git' ? diff.value.find((value) => value.new?.unit)?.new?.unit ??
      diff.value.find((value) => value.old?.unit)?.old?.unit : undefined) ?? selected.value
  const url = new URL(routeHash(id), location.href).href
  manualLink.value = ''
  try {
    await navigator.clipboard.writeText(url)
    copyState.value = 'copied'
  } catch {
    manualLink.value = url
    copyState.value = 'copyFailed'
    await nextTick()
    manualField.value?.select()
  }
}

function changeTarget(id: string, updateHash = true) {
  if (selection.value.edition === 'new') {
    void selectUnit(id, updateHash, false)
    return
  }
  target.value = id
  const chapter = byId.get(id)?.chapterId
  if (chapter) openChapters.value.add(chapter)
  activeRow.value = -1
  copyState.value = ''
  manualLink.value = ''
  if (updateHash) history.replaceState(null, '', routeHash(selected.value))
}

async function openSearch() {
  if (window.matchMedia('(max-width: 800px)').matches) navOpen.value = true
  await nextTick()
  searchField.value?.focus()
}

function closeMobileMenu(event: KeyboardEvent) {
  if (event.key === 'Escape' && navOpen.value) {
    navOpen.value = false
    menuButton.value?.focus()
  }
}

watch(articleEditions, (values) => values.forEach(loadEdition))
watch(searchQuery, (value) => {
  if (value) loadEdition('new')
})

onMounted(() => {
  window.addEventListener('hashchange', readHash)
  window.addEventListener('keydown', closeMobileMenu)
  if (/^#(git|article)\//.test(location.hash) && byId.has(location.hash.split('/')[1])) readHash()
  else void loadChunk(0)
})
onUnmounted(() => {
  window.removeEventListener('hashchange', readHash)
  window.removeEventListener('keydown', closeMobileMenu)
})
</script>

<template>
  <a class="skip-link" href="#comparison">{{ t('skip') }}</a>
  <header>
    <div class="masthead">
      <div class="shell header-content">
        <a class="identity" href="./">
          <span class="brand-icon"><Icon name="book" :size="26" /></span>
          <span>{{ t('title') }}</span>
        </a>
        <button type="button" class="header-search" :aria-label="t('openSearch')" aria-controls="contents-panel" @click="openSearch">
          <Icon name="search" :size="22" />
        </button>
      </div>
    </div>
    <div class="site-nav">
      <nav class="shell nav-content" :aria-label="t('siteControls')">
        <div class="nav-links">
          <a href="#comparison">{{ t('skip') }}</a>
          <a href="#sources">{{ t('sources') }}</a>
        </div>
        <div class="language-toggle" role="group" :aria-label="t('languages')">
          <button type="button" lang="hy" :aria-pressed="locale === 'hy'" @click="locale = 'hy'">{{ t('hy') }}</button>
          <button type="button" lang="ru" :aria-pressed="locale === 'ru'" @click="locale = 'ru'">{{ t('ru') }}</button>
        </div>
      </nav>
    </div>
    <div class="project-notice">
      <p class="shell project-notice-content"><span><Icon name="info" :size="18" /></span>{{ t('disclaimer') }}</p>
    </div>
  </header>

  <main>
    <section class="intro" aria-labelledby="site-title">
      <div class="shell intro-copy">
        <h1 id="site-title">{{ t('title') }}</h1>
        <p>{{ t('intro') }}</p>
      </div>
    </section>

    <div class="shell content-shell">
      <div class="edition-dates">
        <a :href="pdfs.old">
          <Icon name="file" /> <span><strong>{{ t('old') }}</strong><small>{{ t('oldDates') }}</small></span>
          <Icon name="right" :size="16" />
        </a>
        <a :href="pdfs.new">
          <Icon name="file" /> <span><strong>{{ t('new') }}</strong><small>{{ t('newDates') }}</small></span>
          <Icon name="right" :size="16" />
        </a>
      </div>
      <section class="summary" :aria-label="t('statistics')" :title="t('statisticsDetail')">
        <div v-for="{ status, icon } in summary" :key="status" class="stat">
          <span class="stat-icon" :class="status"><Icon :name="icon" :size="19" /></span>
          <span><strong>{{ data.totals[status] }}</strong><small>{{ t(`stats.${status}`) }}</small></span>
        </div>
      </section>
      <div v-if="language === 'ru'" class="edition-notice">
        <Icon name="info" :size="17" />
        <p>{{ t('editionNotice') }} <a :href="sourceUrls.current">{{ t('currentSource') }} <Icon name="external" :size="13" /></a></p>
      </div>
      <div v-if="extractionWarning" class="edition-notice">
        <Icon name="info" :size="17" />
        <p>{{ t('extractionWarning') }} <a :href="extractionReport">{{ t('extractionReport') }}</a></p>
      </div>

      <div class="workspace">
        <aside class="sidebar">
          <button ref="menuButton" class="mobile-menu" type="button" :aria-expanded="navOpen" aria-controls="contents-panel" @click="navOpen = !navOpen">
            <Icon :name="navOpen ? 'close' : 'menu'" /> {{ t('contents') }}
          </button>
          <div id="contents-panel" class="sidebar-content" :class="{ 'mobile-open': navOpen }">
            <h2><Icon name="list" /> {{ t('contents') }}</h2>
            <div class="search-field">
              <Icon name="search" :size="17" />
              <input ref="searchField" v-model="query" type="text" :placeholder="t('searchPlaceholder')" :aria-label="t('search')" />
              <button v-if="query" type="button" class="clear-search" :aria-label="t('clearSearch')" @click="query = ''"><Icon name="close" :size="16" /></button>
            </div>
            <label class="control-check"><input v-model="changedOnly" type="checkbox" /> {{ t('changedOnly') }}</label>
            <nav class="article-list" :aria-label="t('contents')">
              <div v-if="searchLoading && failedText.includes('new')" class="empty-nav" role="alert">
                {{ t('error') }} <button class="text-button" type="button" @click="loadEdition('new')">{{ t('retry') }}</button>
              </div>
              <p v-else-if="searchLoading" class="empty-nav" role="status">{{ t('loading') }}</p>
              <p v-else-if="!navGroups.length" class="empty-nav">{{ t('noResults') }}</p>
              <div v-for="group in navGroups" :key="group.id" class="chapter-group" :class="{ 'chapter-group-intro': !group.chapter }">
                <button v-if="group.chapter" type="button" class="chapter-toggle" :aria-expanded="!!searchQuery || openChapters.has(group.id)"
                  :disabled="!!searchQuery" @click="toggleChapter(group.id)">
                  <span><strong>{{ t('chapter', { number: group.chapter.number }) }}</strong><span class="chapter-name" :lang="language">{{ group.chapter.title }}</span></span>
                  <Icon v-if="!searchQuery" :name="openChapters.has(group.id) ? 'up' : 'down'" :size="14" />
                </button>
                <ul v-if="!group.chapter || searchQuery || openChapters.has(group.id)">
                  <li v-for="unit in group.units" :key="unit.id">
                    <button type="button" class="unit-button" :class="{ current: draftSelection === unit.id }" :aria-current="draftSelection === unit.id ? 'true' : undefined" @click="selectUnit(unit.id)">
                      <span><strong>{{ unitLabel(unit) }}</strong></span>
                      <span v-if="unit.title" class="unit-title" :lang="language">{{ unit.title }}</span>
                      <Icon v-if="draftSelection === unit.id" name="right" :size="15" />
                    </button>
                  </li>
                </ul>
              </div>
            </nav>
          </div>
        </aside>

        <section id="comparison" ref="workspace" class="comparison" tabindex="-1" aria-labelledby="comparison-title">
          <div class="mode-bar">
            <div class="mode-tabs" role="group" :aria-label="t('mode')">
              <button type="button" :aria-pressed="mode === 'git'" @click="setMode('git')"><Icon name="diff" /> {{ t('gitDiff') }}</button>
              <button type="button" :aria-pressed="mode === 'article'" @click="setMode('article')"><Icon name="book" /> {{ t('byArticle') }}</button>
            </div>
            <button type="button" class="icon-button copy-button" :aria-label="t('copy')" :title="t('copy')" @click="copyLink"><Icon name="link" :size="18" /></button>
          </div>
          <div class="copy-feedback" v-if="copyState">
            <span role="status">{{ t(copyState) }}</span>
            <input v-if="manualLink" ref="manualField" :value="manualLink" :aria-label="t('copy')" readonly />
          </div>

          <div class="reading-head">
            <h2 id="comparison-title" :lang="mode === 'article' && selection.title ? language : undefined">{{ heading }}</h2>
            <span v-if="mode === 'article'" class="status-label" :class="articleStatus">{{ t(`status.${articleStatus}`) }}</span>
            <span v-else class="page-label">{{ t('page', { page: chunk + 1, total: data.chunkCount }) }}</span>
          </div>
          <div v-if="mode === 'article'" class="mapping-details">
            <p v-if="mapping">
              <strong v-if="mapping.scope">{{ t('partial') }}. </strong>{{ t(`evidence.${mapping.evidence}`) }}
            </p>
            <p v-else>{{ t('unmappedExplanation') }}</p>
            <div v-if="targetOptions.length > 1" class="target-options segmented" role="group" :aria-label="t('new')">
              <button v-for="unit in targetOptions" :key="unit.id" type="button" :aria-pressed="target === unit.id" @click="changeTarget(unit.id)">{{ unitLabel(unit) }}</button>
            </div>
          </div>

          <div v-if="articleLoading && articleEditions.some((edition) => failedText.includes(edition))" class="empty-diff" role="alert">
            {{ t('error') }} <button class="text-button" type="button" @click="articleEditions.forEach(loadEdition)">{{ t('retry') }}</button>
          </div>
          <p v-else-if="articleLoading" class="empty-diff" role="status">{{ t('loading') }}</p>
          <div v-else-if="mode === 'git' || mapping" class="toolbar">
            <div class="layout-buttons segmented" role="group" :aria-label="t('layout')">
              <button type="button" :aria-pressed="layout === 'split'" @click="layout = 'split'"><Icon name="split" :size="17" /> {{ t('split') }}</button>
              <button type="button" :aria-pressed="layout === 'unified'" @click="layout = 'unified'"><Icon name="unified" :size="17" /> {{ t('unified') }}</button>
            </div>
            <label class="control-check"><input v-model="hideEqual" type="checkbox" /> {{ t('hideEqual') }}</label>
            <div class="change-nav">
              <span class="change-position" aria-live="polite">{{ currentChange < 0 ? t('changeCount', { total: currentChanges.length }) : t('change', { position: currentChange + 1, total: currentChanges.length }) }}</span>
              <button class="icon-button" type="button" :aria-label="t('previousChange')" :title="t('previousChange')" :disabled="!currentChanges.length" @click="jumpChange(-1)"><Icon name="up" :size="16" /></button>
              <button class="icon-button" type="button" :aria-label="t('nextChange')" :title="t('nextChange')" :disabled="!currentChanges.length" @click="jumpChange(1)"><Icon name="down" :size="16" /></button>
            </div>
          </div>

          <div v-if="!articleLoading && (mode === 'git' || mapping)" class="diff-viewport" :class="layout">
            <div class="edition-headings">
              <div v-for="edition in editions" :key="edition" class="edition-heading">
                <Icon name="file" :size="19" />
                <span><strong>{{ t(edition) }}</strong><small>{{ t(`${edition}Dates`) }}</small></span>
                <span v-if="edition === 'new'" class="draft-label">{{ t('draftBadge') }}</span>
                <a v-if="mode === 'git' || (edition === 'old' ? oldUnit : newUnit)" :href="mode === 'git' ? pdfs[edition] : unitPdf((edition === 'old' ? oldUnit : newUnit)!)"
                  :aria-label="t(mode === 'git' ? 'pdf' : 'readSource') + ' · ' + t(edition)" :title="t(mode === 'git' ? 'pdf' : 'readSource')"><Icon name="external" :size="15" /></a>
              </div>
            </div>
            <p v-if="mode === 'git' && loading" class="empty-diff" role="status">{{ t('loading') }}</p>
            <div v-else-if="mode === 'git' && failed" class="empty-diff" role="alert">
              {{ t('error') }} <button class="text-button" type="button" @click="loadChunk(chunk)">{{ t('retry') }}</button>
            </div>
            <p v-else-if="!displayRows.length" class="empty-diff">{{ t('noneVisible') }}</p>
            <template v-else>
              <p v-if="mode === 'article' && (!oldUnit || !newUnit)" class="missing-side">{{ t('noCounterpart') }}</p>
              <div v-for="{ row, index } in displayRows" :id="`diff-row-${index}`" :key="index" tabindex="-1"
                class="diff-row" :class="{ 'active-row': activeRow === index, 'equal-row': row.equal }">
                <template v-if="layout === 'split'">
                  <DiffCell :language="language" :line="row.old" :parts="row.oldParts" :tone="row.equal ? 'same' : 'deletion'" paired />
                  <DiffCell :language="language" :line="row.new" :parts="row.newParts" :tone="row.equal ? 'same' : 'insertion'" paired />
                </template>
                <template v-else>
                  <DiffCell :language="language" v-if="row.old" :line="row.old" :parts="row.oldParts" :tone="row.equal ? 'same' : 'deletion'" />
                  <DiffCell :language="language" v-if="!row.equal || row.old?.text !== row.new?.text" :line="row.new" :parts="row.newParts" :tone="row.equal ? 'same' : 'insertion'" />
                </template>
              </div>
            </template>
          </div>

          <article v-else-if="!articleLoading" class="original" aria-labelledby="comparison-title">
            <div class="original-source"><strong>{{ t(selection.edition) }}</strong><a :href="unitPdf(selection)">{{ t('readSource') }} <Icon name="external" :size="14" /></a></div>
            <div class="original-text" :lang="language">
              <p v-if="selection.heading" class="font-bold">{{ selection.heading }}</p>
              <p v-for="(paragraph, index) in paragraphsFor(selection)" :key="index" :class="paragraph.level">{{ paragraph.text }}</p>
            </div>
          </article>

          <div v-if="!articleLoading && (mode === 'git' || mapping)" class="diff-footer">
            <div class="legend">
              <span><b class="legend-sign removed" aria-hidden="true">−</b> {{ t('deletion') }}</span>
              <span><b class="legend-sign added" aria-hidden="true">+</b> {{ t('insertion') }}</span>
              <span><b class="legend-sign modified" aria-hidden="true">~</b> {{ t('modifiedText') }}</span>
              <span><b class="legend-sign same" aria-hidden="true">=</b> {{ t('same') }}</span>
            </div>
            <div v-if="mode === 'git'" class="page-nav">
              <button type="button" class="icon-button" :aria-label="t('previousPage')" :title="t('previousPage')" :disabled="chunk === 0" @click="turnPage(-1)"><Icon name="left" :size="17" /></button>
              <button type="button" class="icon-button" :aria-label="t('nextPage')" :title="t('nextPage')" :disabled="chunk === data.chunkCount - 1" @click="turnPage(1)"><Icon name="right" :size="17" /></button>
            </div>
          </div>
          <p class="reading-note">{{ t(mode === 'git' ? 'gitExplanation' : 'articleExplanation') }}</p>
        </section>
      </div>

      <section id="sources" class="source-section" aria-labelledby="sources-title">
        <h2 id="sources-title">{{ t('sources') }}</h2>
        <p>{{ t('sourceDetails') }}</p>
        <div class="source-links">
          <a :href="pdfs.old">{{ t('old') }} · {{ t('pdf') }} <Icon name="file" :size="15" /></a>
          <a :href="pdfs.new">{{ t('new') }} · {{ t('pdf') }} <Icon name="file" :size="15" /></a>
          <a :href="sourceUrls.current">{{ t('currentSource') }} <Icon name="external" :size="15" /></a>
          <a :href="sourceUrls.draft">{{ t('draftSource') }} <Icon name="external" :size="15" /></a>
          <a :href="extractionReport">{{ t('extractionReport') }} <Icon name="file" :size="15" /></a>
        </div>
        <details class="help">
          <summary>{{ t('help') }}</summary>
          <p>{{ t('gitExplanation') }}</p>
          <p>{{ t('articleExplanation') }}</p>
          <p>{{ t('statisticsDetail') }}</p>
        </details>
      </section>
    </div>
  </main>
  <footer class="site-footer"><div class="shell">{{ t('independent') }}</div></footer>
</template>
