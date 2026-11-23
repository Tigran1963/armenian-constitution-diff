<script setup lang="ts">
const paths = {
  book: 'M12 6.5c-2.8-2-5.8-2.5-9-1.4v13.3c3.2-1 6.2-.6 9 1.6 2.8-2.2 5.8-2.6 9-1.6V5.1c-3.2-1.1-6.2-.6-9 1.4Zm0 0V20',
  external: 'M13 5h6v6m0-6-8 8m6 0v6H5V7h6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  swap: 'M4 8h15l-4-4m5 12H5l4 4',
  question: 'M9 9a3 3 0 1 1 4.8 2.4c-1.4 1-1.8 1.7-1.8 2.6m0 3h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  info: 'M12 11v5m0-8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
  search: 'M21 21l-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  down: 'm6 9 6 6 6-6',
  up: 'm6 15 6-6 6 6',
  left: 'm15 6-6 6 6 6',
  right: 'm9 6 6 6-6 6',
  menu: 'M3 6h18M3 12h18M3 18h18',
  close: 'm6 6 12 12M18 6 6 18',
  split: 'M3 5h18v14H3zM12 5v14',
  unified: 'M4 5h16M4 10h16M4 15h16M4 20h16',
  diff: 'M6 3v6m-3-3h6m6 12h6M4 18h5m6-12h5M9 18c4 0 2-12 6-12',
  link: 'M10 13.7a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.7 1.7m2.7 3.6a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.7-1.7',
  file: 'M5 3h9l5 5v13H5zM14 3v6h5M8 13h8m-8 4h8',
  list: 'M9 6h12M9 12h12M9 18h12M3 6h.01M3 12h.01M3 18h.01',
  check: 'm5 12 4 4L19 6',
} as const
defineProps<{ name: keyof typeof paths; size?: number }>()
</script>

<template>
  <svg :width="size ?? 18" :height="size ?? 18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name]" />
  </svg>
</template>
