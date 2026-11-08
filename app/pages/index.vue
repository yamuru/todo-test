<script setup lang="ts">
import ConfirmDialog from '~/components/dialog/ConfirmDialog.vue'
import type { Note } from '~/domain/models/note'
import { useNotesStore } from '~/stores/notes'
import { useEditorStore } from '~/stores/editor'

useHead({ title: 'Мои заметки' })
const notes = useNotesStore()
const editor = useEditorStore()
const notice = useNotice()
const deletion = ref<Note | null>(null)
const confirmOpen = ref(false)
const deleteError = ref('')
const busy = ref(false)
const draftCount = ref(0)
const draftError = ref('')

function refresh() {
  notes.load()
  const found = editor.discoverDrafts()
  draftError.value = found.ok ? '' : found.error.message
  draftCount.value = found.ok ? found.value.length : 0
}
function askDelete(note: Note) {
  deletion.value = note
  deleteError.value = ''
  confirmOpen.value = true
}
async function remove() {
  if (!deletion.value || busy.value) return
  busy.value = true
  const index = notes.notes.findIndex((note) => note.id === deletion.value?.id)
  const result = notes.deleteNote(deletion.value.id)
  busy.value = false
  if (!result.ok) {
    deleteError.value = result.error.message
    return
  }
  confirmOpen.value = false
  notice.value = 'Заметка удалена'
  refresh()
  await nextTick()
  const nextNote = notes.notes[Math.min(index, notes.notes.length - 1)]
  const link = [
    ...document.querySelectorAll<HTMLElement>('[data-note-link]'),
  ].find((element) => element.dataset.noteLink === nextNote?.id)
  ;(link ?? document.querySelector<HTMLElement>('[data-create-note]'))?.focus()
}
function retryCleanup(sessionId: string) {
  const result = editor.retryDraftCleanup(sessionId)
  notice.value = result.ok
    ? 'Черновик удалён. Заметка сохранена'
    : result.error.message
  refresh()
}
onMounted(() => {
  refresh()
  window.addEventListener('storage', refresh)
})
onBeforeUnmount(() => window.removeEventListener('storage', refresh))
</script>

<template>
  <section class="notes-page" aria-labelledby="notes-heading">
    <header class="notes-page__header">
      <h1 id="notes-heading" tabindex="-1">Мои заметки</h1>
      <NuxtLink
        v-if="notes.loaded && !notes.error && notes.notes.length"
        to="/notes/new"
        class="create-link"
        data-create-note
        ><UiIcon name="plus" />Создать заметку</NuxtLink
      >
    </header>
    <p v-if="notice" class="notes-page__notice" role="status">{{ notice }}</p>
    <div
      v-for="task in editor.cleanupTasks"
      :key="task.identity.sessionId"
      class="notes-page__warning"
      role="alert"
    >
      <p>
        Заметка сохранена, но её черновик не удалось удалить. При повторном
        открытии он может быть устаревшим.
      </p>
      <UiButton
        variant="secondary"
        @click="retryCleanup(task.identity.sessionId)"
        >Повторить очистку черновика</UiButton
      >
    </div>
    <div v-if="notes.error" class="notes-page__surface" role="alert">
      <h2>Не удалось прочитать заметки</h2>
      <p>{{ notes.error.message }}. Данные на устройстве не изменены.</p>
      <UiButton variant="secondary" @click="refresh"
        >Повторить загрузку</UiButton
      >
    </div>
    <p v-else-if="!notes.loaded" role="status">Загрузка заметок…</p>
    <template v-else>
      <div v-if="draftCount" class="notes-page__drafts">
        <NuxtLink to="/notes/new?recovery=all"
          >Незавершённые черновики: {{ draftCount }}</NuxtLink
        >
      </div>
      <div v-if="draftError" class="notes-page__warning" role="alert">
        <p>Не удалось проверить черновики. {{ draftError }}</p>
        <UiButton variant="secondary" @click="refresh"
          >Повторить проверку</UiButton
        >
      </div>
      <ul v-if="notes.notes.length" class="notes-page__grid">
        <li v-for="note in notes.notes" :key="note.id">
          <NoteCard :note="note" @delete="askDelete(note)" />
        </li>
      </ul>
      <div v-else class="notes-page__surface notes-page__empty">
        <h2>Пока нет заметок</h2>
        <NuxtLink to="/notes/new" class="create-link" data-create-note
          ><UiIcon name="plus" />Создать заметку</NuxtLink
        >
      </div>
    </template>
    <ConfirmDialog
      v-model="confirmOpen"
      title="Удалить заметку?"
      :description="`Заметка «${deletion?.title ?? ''}» и все её задачи будут удалены. Восстановить их после удаления нельзя.`"
      confirm-label="Удалить заметку"
      cancel-label="Не удалять"
      danger
      :error="deleteError"
      :busy="busy"
      @confirm="remove"
    />
  </section>
</template>

<style scoped lang="scss">
@use '~/assets/styles/tools' as tools;
.create-link {
  @include tools.button;
  background: var(--color-accent);
  color: var(--color-on-accent);
  text-decoration: none;
  &:hover {
    background: var(--color-accent-hover);
  }
}
.notes-page {
  &__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--space-6);
    margin-bottom: var(--space-8);
  }
  &__grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-6);
    list-style: none;
    padding: 0;
  }
  &__grid > li {
    min-width: 0;
  }
  &__surface {
    display: grid;
    justify-items: start;
    gap: var(--space-5);
    padding: var(--space-8);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }
  &__empty {
    justify-items: center;
    padding-block: var(--space-16);
    text-align: center;
  }
  &__notice,
  &__drafts {
    margin-bottom: var(--space-6);
  }
  &__notice {
    color: var(--color-accent);
  }
  &__warning {
    display: grid;
    justify-items: start;
    gap: var(--space-4);
    margin-bottom: var(--space-6);
    padding: var(--space-5);
    border: 1px solid var(--color-danger);
    border-radius: var(--radius-md);
  }
  @media (min-width: 40rem) {
    &__grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 64rem) {
    &__grid {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  @media (max-width: 30rem) {
    &__header .create-link {
      width: 100%;
    }
    &__surface {
      padding-inline: var(--space-4);
    }
  }
}
</style>
