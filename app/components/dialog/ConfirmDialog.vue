<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string
    description: string
    confirmLabel: string
    cancelLabel?: string
    danger?: boolean
    error?: string
    busy?: boolean
  }>(),
  { cancelLabel: 'Продолжить работу', danger: false, error: '', busy: false },
)
const open = defineModel<boolean>({ default: false })
defineEmits<{ confirm: [] }>()
</script>

<template>
  <UiDialog v-model="open" :title="title" :description="description">
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <div class="actions">
      <UiButton
        variant="secondary"
        autofocus
        :disabled="busy"
        @click="open = false"
        >{{ cancelLabel }}</UiButton
      >
      <UiButton
        :variant="danger ? 'danger' : 'primary'"
        :disabled="busy"
        @click="$emit('confirm')"
        >{{ confirmLabel }}</UiButton
      >
    </div>
  </UiDialog>
</template>

<style scoped lang="scss">
.actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-3);
  margin-top: var(--space-6);
}
.error {
  margin-top: var(--space-4);
  color: var(--color-danger);
}
@media (max-width: 30rem) {
  .actions {
    flex-direction: column;
  }
}
</style>
