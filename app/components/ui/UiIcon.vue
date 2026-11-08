<script setup lang="ts">
import { ArrowLeft, Plus, Redo2, Trash2, Undo2 } from '@lucide/vue'

const icons = {
  trash: Trash2,
  undo: Undo2,
  redo: Redo2,
  plus: Plus,
  back: ArrowLeft,
}
withDefaults(
  defineProps<{
    name: keyof typeof icons
    size?: number
    strokeWidth?: number
  }>(),
  { size: 20, strokeWidth: 1.75 },
)
</script>

<template>
  <component
    :is="icons[name]"
    :size="size"
    :stroke-width="strokeWidth"
    aria-hidden="true"
    focusable="false"
  />
</template>
