<script setup lang="ts">
import type { ButtonHTMLAttributes } from 'vue'

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'danger'
    size?: 'sm' | 'md'
    type?: ButtonHTMLAttributes['type']
    disabled?: boolean
  }>(),
  { variant: 'primary', size: 'md', type: 'button', disabled: false },
)
</script>

<template>
  <button
    class="ui-button"
    :class="[`ui-button--${variant}`, `ui-button--${size}`]"
    :type="type"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped lang="scss">
@use '~/assets/styles/tools' as tools;

.ui-button {
  @include tools.button;
}
</style>
