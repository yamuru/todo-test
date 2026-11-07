<script setup lang="ts">
import type { ButtonHTMLAttributes } from 'vue'

withDefaults(
  defineProps<{
    label: string
    variant?: 'primary' | 'secondary' | 'danger'
    size?: 'sm' | 'md'
    type?: ButtonHTMLAttributes['type']
    disabled?: boolean
  }>(),
  { variant: 'secondary', size: 'md', type: 'button', disabled: false },
)
</script>

<template>
  <button
    class="ui-icon-button"
    :class="[`ui-icon-button--${variant}`, `ui-icon-button--${size}`]"
    :aria-label="label"
    :type="type"
    :disabled="disabled"
  >
    <slot />
  </button>
</template>

<style scoped lang="scss">
@use '~/assets/styles/tools' as tools;

.ui-icon-button {
  @include tools.button;

  flex: 0 0 auto;
  width: var(--control-size-md);
  height: var(--control-size-md);
  padding: var(--space-3);

  &--sm {
    width: var(--control-size-sm);
    height: var(--control-size-sm);
    padding: var(--space-3);
  }
}
</style>
