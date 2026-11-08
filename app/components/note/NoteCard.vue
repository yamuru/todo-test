<script setup lang="ts">
import type { Note } from '~/domain/models/note'
const props = defineProps<{ note: Note }>()
defineEmits<{ delete: [] }>()
const completed = computed(
  () => props.note.todos.filter((todo) => todo.completed).length,
)
</script>

<template>
  <article class="note-card">
    <h2>
      <NuxtLink
        :to="`/notes/${encodeURIComponent(note.id)}`"
        :data-note-link="note.id"
        :title="note.title"
        >{{ note.title }}</NuxtLink
      >
    </h2>
    <ul v-if="note.todos.length" class="note-card__todos">
      <li
        v-for="todo in note.todos.slice(0, 3)"
        :key="todo.id"
        :class="{ completed: todo.completed }"
      >
        <span aria-hidden="true" class="note-card__mark">{{
          todo.completed ? '✓' : '—'
        }}</span>
        <span class="visually-hidden">{{
          todo.completed ? 'Выполнено: ' : 'Не выполнено: '
        }}</span>
        <span class="note-card__preview">{{ todo.text }}</span>
      </li>
    </ul>
    <p v-else class="note-card__empty">Нет задач</p>
    <p v-if="note.todos.length > 3" class="note-card__more">
      Ещё задач: {{ note.todos.length - 3 }}
    </p>
    <footer class="note-card__footer">
      <span v-if="note.todos.length"
        >Выполнено {{ completed }} из {{ note.todos.length }}</span
      >
      <UiIconButton
        :label="`Удалить заметку «${note.title}»`"
        @click="$emit('delete')"
        ><UiIcon name="trash"
      /></UiIconButton>
    </footer>
  </article>
</template>

<style scoped lang="scss">
.note-card {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  padding: var(--space-6);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  background: var(--color-surface);
  h2 {
    font-size: var(--font-size-lg);
    line-height: var(--line-height-compact);
  }
  h2 a {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    color: var(--color-text-primary);
    text-decoration: none;
  }
  h2 a:hover {
    text-decoration: underline;
  }
  &__todos {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-5);
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    min-width: 0;
  }
  &__mark {
    flex: 0 0 1.25rem;
    color: var(--color-accent);
  }
  &__preview {
    display: -webkit-box;
    overflow: hidden;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    white-space: pre-wrap;
  }
  .completed &__preview {
    color: var(--color-text-secondary);
    text-decoration: line-through;
  }
  &__empty,
  &__more {
    margin-top: var(--space-4);
    color: var(--color-text-secondary);
  }
  &__more {
    font-size: var(--font-size-sm);
  }
  &__footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    margin-top: auto;
    padding-top: var(--space-6);
    color: var(--color-text-secondary);
    font-size: var(--font-size-sm);
  }
  &__footer button {
    margin-left: auto;
  }
}
</style>
