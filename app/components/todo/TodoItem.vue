<script setup lang="ts">
import type { Todo } from '~/domain/models/todo'
defineProps<{ todo: Todo; index: number; error?: string }>()
defineEmits<{ text: [text: string]; toggle: []; delete: []; finish: [] }>()
const id = useId()
</script>

<template>
  <li class="todo-item">
    <UiCheckbox
      :model-value="todo.completed"
      :label="`Задача ${index + 1} выполнена`"
      visually-hidden-label
      @update:model-value="$emit('toggle')"
    />
    <div class="todo-item__field">
      <label class="visually-hidden" :for="id"
        >Текст задачи {{ index + 1 }}</label
      >
      <textarea
        :id="id"
        :value="todo.text"
        required
        rows="2"
        :aria-invalid="error ? true : undefined"
        :aria-describedby="error ? `${id}-error` : undefined"
        @input="$emit('text', ($event.target as HTMLTextAreaElement).value)"
        @blur="$emit('finish')"
      />
      <p v-if="error" :id="`${id}-error`" role="alert">{{ error }}</p>
    </div>
    <UiIconButton
      :label="`Удалить задачу ${index + 1}`"
      @click="$emit('delete')"
      ><UiIcon name="trash"
    /></UiIconButton>
  </li>
</template>

<style scoped lang="scss">
.todo-item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-2);
  min-width: 0;
  &__field {
    flex: 1;
    min-width: 0;
  }
  textarea {
    display: block;
    width: 100%;
    min-height: var(--control-size-md);
    padding: var(--space-3);
    resize: vertical;
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-sm);
    background: var(--color-surface);
    color: var(--color-text-primary);
    font: inherit;
    line-height: var(--line-height-compact);
  }
  textarea[aria-invalid='true'] {
    border-color: var(--color-danger);
  }
  p {
    margin-top: var(--space-2);
    font-size: var(--font-size-sm);
    color: var(--color-danger);
  }
}
</style>
