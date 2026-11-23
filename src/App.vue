<script setup lang="ts">
import { ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Comparison from './Comparison.vue'
import type { Dataset } from './dataset'
import type { Language } from './documents'

const { locale, t } = useI18n()
const loaded = shallowRef<{ language: Language; data: Dataset }>()
const failed = ref(false)
const retry = ref(0)
const loaders = {
  hy: () => import('../generated/hy/dataset.json'),
  ru: () => import('../generated/ru/dataset.json'),
}

watch([locale, retry], async ([value], _, onCleanup) => {
  const language = value === 'ru' ? 'ru' : 'hy'
  let stale = false
  onCleanup(() => { stale = true })
  document.documentElement.lang = language
  document.title = t('title')
  localStorage.setItem('constitution-language', language)
  failed.value = false
  try {
    const { default: data } = await loaders[language]()
    if (!stale) loaded.value = { language, data: data as Dataset }
  } catch {
    if (!stale) failed.value = true
  }
}, { immediate: true })
</script>

<template>
  <Comparison v-if="loaded" :key="loaded.language" :language="loaded.language" :data="loaded.data" />
  <div v-if="failed" class="shell empty-diff" role="alert">
    {{ t('error') }} <button type="button" class="text-button" @click="retry++">{{ t('retry') }}</button>
  </div>
  <p v-else-if="!loaded" class="shell empty-diff" role="status">{{ t('loading') }}</p>
</template>
