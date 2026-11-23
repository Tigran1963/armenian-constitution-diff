<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { Line, Part } from '../diffs'
import type { Language } from '../documents'
const { t } = useI18n()
defineProps<{ language: Language; line: Line | null; parts?: Part[]; tone: 'deletion' | 'insertion' | 'same'; paired?: boolean }>()
</script>

<template>
  <div v-if="line" class="diff-cell" :class="[tone, line.kind, { 'whole-line': !parts }]">
    <span v-if="line.no" class="line-no" aria-hidden="true">{{ line.no }}</span>
    <span class="diff-sign" aria-hidden="true">{{ parts ? '~' : tone === 'deletion' ? '−' : tone === 'insertion' ? '+' : '=' }}</span>
    <div class="line-text">
      <span v-if="tone !== 'same'" class="sr-only">{{ t(parts ? 'modifiedText' : tone) }} </span>
      <span v-if="line.kind === 'preamble'">{{ t('preamble') }}</span>
      <p v-else :lang="language"><template v-if="parts"><template v-for="(part, index) in parts" :key="index"><span v-if="!part.changed">{{ part.text }}</span><del v-else-if="tone === 'deletion'">{{ part.text }}</del><ins v-else>{{ part.text }}</ins></template></template><template v-else>{{ line.text }}</template></p>
    </div>
  </div>
  <div v-else-if="paired" class="diff-cell gap-cell" aria-hidden="true"></div>
</template>
