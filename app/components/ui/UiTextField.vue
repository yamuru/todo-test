<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    label: string
    id?: string
    placeholder?: string
    hint?: string
    error?: string
    disabled?: boolean
  }>(),
  { id: undefined, placeholder: '', hint: '', error: '', disabled: false },
)

const model = defineModel<string>({ default: '' })
const input = useTemplateRef<HTMLInputElement>('input')
defineExpose({ focus: () => input.value?.focus() })
const attrs = useAttrs()
const generatedId = useId()
const inputId = computed(() => props.id ?? generatedId)

function describedBy() {
  return (
    [
      attrs['aria-describedby'],
      props.hint ? `${inputId.value}-hint` : undefined,
      props.error ? `${inputId.value}-error` : undefined,
    ]
      .filter(Boolean)
      .join(' ') || undefined
  )
}
</script>

<template>
  <div class="ui-text-field" :class="{ 'ui-text-field--disabled': disabled }">
    <label class="ui-text-field__label" :for="inputId">{{ label }}</label>
    <input
      v-bind="{ ...$attrs, ...(error ? { 'aria-invalid': true } : {}) }"
      :id="inputId"
      ref="input"
      v-model="model"
      class="ui-text-field__input"
      :class="{ 'ui-text-field__input--error': error }"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-describedby="describedBy()"
    />
    <p v-if="hint" :id="`${inputId}-hint`" class="ui-text-field__hint">
      {{ hint }}
    </p>
    <p
      v-if="error"
      :id="`${inputId}-error`"
      class="ui-text-field__error"
      role="alert"
    >
      {{ error }}
    </p>
  </div>
</template>

<style scoped lang="scss">
.ui-text-field {
  display: grid;
  min-width: 0;
  gap: var(--space-2);

  &__label {
    width: fit-content;
    font-size: var(--font-size-sm);
    font-weight: var(--font-weight-semibold);
    line-height: var(--line-height-compact);
  }

  &__input {
    width: 100%;
    min-height: var(--control-size-md);
    padding: var(--space-2) var(--space-4);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text-primary);
    font-size: var(--font-size-md);
    line-height: var(--line-height-compact);
    transition:
      border-color var(--duration-fast) var(--ease-standard),
      background-color var(--duration-fast) var(--ease-standard);

    &::placeholder {
      color: var(--color-text-secondary);
      opacity: 1;
    }

    @media (hover: hover) {
      &:hover:enabled {
        border-color: var(--color-accent);
      }
    }

    &:focus-visible {
      border-color: var(--color-accent);
    }

    &--error,
    &--error:hover:enabled,
    &--error:focus-visible {
      border-color: var(--color-danger);
    }

    &:disabled {
      background: var(--color-disabled-surface);
      color: var(--color-disabled-text);
      cursor: not-allowed;
    }
  }

  &__hint,
  &__error {
    font-size: var(--font-size-sm);
    line-height: var(--line-height-compact);
  }

  &__hint {
    color: var(--color-text-secondary);
  }

  &__error {
    color: var(--color-danger);
  }

  &--disabled &__label {
    color: var(--color-disabled-text);
  }
}
</style>
