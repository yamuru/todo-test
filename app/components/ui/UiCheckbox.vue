<script setup lang="ts">
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    label: string
    id?: string
    disabled?: boolean
    visuallyHiddenLabel?: boolean
  }>(),
  { id: undefined, disabled: false, visuallyHiddenLabel: false },
)

const model = defineModel<boolean>({ default: false })
const generatedId = useId()
const inputId = computed(() => props.id ?? generatedId)
</script>

<template>
  <label
    class="ui-checkbox"
    :class="{ 'ui-checkbox--disabled': disabled }"
    :for="inputId"
  >
    <input
      v-bind="$attrs"
      :id="inputId"
      v-model="model"
      class="ui-checkbox__input"
      type="checkbox"
      :disabled="disabled"
    />
    <span
      class="ui-checkbox__label"
      :class="{ 'visually-hidden': visuallyHiddenLabel }"
      >{{ label }}</span
    >
  </label>
</template>

<style scoped lang="scss">
.ui-checkbox {
  display: flex;
  align-items: flex-start;
  gap: var(--space-3);
  width: fit-content;
  max-width: 100%;
  min-height: var(--control-size-sm);
  padding-block: var(--space-3);
  cursor: pointer;

  &__input {
    flex: 0 0 auto;
    width: var(--space-5);
    height: var(--space-5);
    margin: 2px 0;
    accent-color: var(--color-accent);
    cursor: inherit;
  }

  &__label {
    min-width: 0;
    line-height: var(--line-height-compact);
  }

  &--disabled {
    color: var(--color-disabled-text);
    cursor: not-allowed;
  }
}
</style>
