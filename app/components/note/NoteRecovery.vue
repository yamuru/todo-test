<script setup lang="ts">
import ConfirmDialog from '~/components/dialog/ConfirmDialog.vue'
import { useEditorStore } from '~/stores/editor'
import { useNotesStore } from '~/stores/notes'

const props = defineProps<{ noteId?: string }>()
const open = defineModel<boolean>({ default: false })
const emit = defineEmits<{ ready: []; empty: []; create: [] }>()
const editor = useEditorStore()
const notes = useNotesStore()
const selectedId = ref('')
const error = ref('')
const deleteOpen = ref(false)
const selected = computed(() =>
  editor.recoveryChoices.find((item) => item.id === selectedId.value),
)
const savedId = computed(() => props.noteId ?? selected.value?.noteId)
const hasSavedVersion = computed(
  () => !!savedId.value && !!notes.getNote(savedId.value),
)
watch(
  () => editor.recoveryChoices,
  (choices) => {
    selectedId.value = choices.length === 1 ? choices[0]!.id : ''
  },
  { immediate: true },
)

function restore() {
  if (!selected.value) return
  const selection = editor.selectRecovery(selected.value.id)
  if (!selection.ok) {
    error.value = selection.error.message
    return
  }
  const result = editor.restoreDraft()
  if (!result.ok) {
    error.value = result.error.message
    return
  }
  open.value = false
  emit('ready')
}
function editSaved() {
  if (!savedId.value) return
  const result = editor.editSavedVersion(savedId.value)
  if (!result.ok) {
    error.value = result.error.message
    return
  }
  open.value = false
  emit('ready')
}
function remove() {
  if (!selected.value) return
  const candidate = selected.value
  editor.selectRecovery(candidate.id)
  const result = candidate.error
    ? editor.discardCorruptedDraft(candidate.id)
    : editor.discardRecovery()
  if (!result.ok) {
    error.value = result.error.message
    deleteOpen.value = false
    return
  }
  deleteOpen.value = false
  error.value = ''
  if (editor.active) {
    open.value = false
    emit('ready')
  } else if (!editor.recoveryChoices.length) {
    open.value = false
    emit('empty')
  }
}
function refresh() {
  const result = editor.offerRecovery(props.noteId)
  error.value = result.ok
    ? ''
    : result.error.code === 'not-found'
      ? ''
      : result.error.message
  if (
    !editor.recoveryChoices.length &&
    (result.ok || result.error.code === 'not-found')
  ) {
    open.value = false
    emit('empty')
  }
}
function date(value: number) {
  if (Number.isNaN(new Date(value).getTime())) return 'Дата неизвестна'
  return new Intl.DateTimeFormat('ru', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value)
}
</script>

<template>
  <UiDialog
    v-model="open"
    title="Восстановить черновик?"
    description="Восстановление откроет рабочую копию. Чтобы сохранить заметку окончательно, нажмите «Сохранить» в редакторе."
  >
    <fieldset class="recovery__choices">
      <legend class="visually-hidden">Выберите черновик</legend>
      <label
        v-for="(candidate, index) in editor.recoveryChoices"
        :key="candidate.id"
        class="recovery__choice"
      >
        <input
          v-model="selectedId"
          type="radio"
          name="draft"
          :value="candidate.id"
        />
        <span>
          <strong>{{
            candidate.draft?.note.title.trim() ||
            (candidate.error ? 'Повреждённый черновик' : 'Без названия')
          }}</strong>
          <span v-if="candidate.draft"
            >{{ date(candidate.draft.updatedAt) }} · Черновик
            {{ index + 1 }}</span
          >
          <span v-if="candidate.conflict === 'changed'"
            >Сохранённая заметка уже изменилась. Этот черновик может быть
            устаревшим.</span
          >
          <span v-if="candidate.conflict === 'deleted'"
            >Заметка удалена. Черновик можно открыть для просмотра; сохранить
            под прежним идентификатором нельзя.</span
          >
          <span v-if="candidate.error"
            >{{ candidate.error.message }}. Данные не удалены.</span
          >
        </span>
      </label>
    </fieldset>
    <p v-if="error" class="recovery__error" role="alert">{{ error }}</p>
    <div class="recovery__actions">
      <UiButton variant="secondary" autofocus @click="open = false"
        >Решить позже</UiButton
      >
      <UiButton :disabled="!selected?.draft" @click="restore"
        >Восстановить</UiButton
      >
      <UiButton v-if="hasSavedVersion" variant="secondary" @click="editSaved"
        >Открыть сохранённую версию</UiButton
      >
      <UiButton v-if="!noteId" variant="secondary" @click="$emit('create')"
        >Создать новую заметку</UiButton
      >
      <UiButton
        variant="secondary"
        :disabled="!selected"
        @click="deleteOpen = true"
        >Удалить выбранный черновик</UiButton
      >
      <UiButton v-if="error" variant="secondary" @click="refresh"
        >Обновить список черновиков</UiButton
      >
    </div>
    <ConfirmDialog
      v-model="deleteOpen"
      title="Удалить черновик?"
      description="Будет удалена только выбранная рабочая копия. Сохранённая заметка и другие черновики останутся. Восстановить эту копию будет нельзя."
      confirm-label="Удалить черновик"
      cancel-label="Не удалять"
      danger
      @confirm="remove"
    />
  </UiDialog>
</template>

<style scoped lang="scss">
.recovery {
  &__choices {
    display: grid;
    gap: var(--space-3);
    min-width: 0;
    margin-top: var(--space-5);
    padding: 0;
    border: 0;
  }
  &__choice {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    min-height: var(--control-size-md);
    padding: var(--space-3);
    border: 1px solid var(--color-border-control);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  &__choice input {
    flex: 0 0 auto;
    margin-top: var(--space-1);
    accent-color: var(--color-accent);
    width: 1.25rem;
    height: 1.25rem;
  }
  &__choice > span {
    display: grid;
    gap: var(--space-2);
    min-width: 0;
  }
  &__choice span span {
    font-size: var(--font-size-sm);
    color: var(--color-text-secondary);
  }
  &__error {
    margin-top: var(--space-4);
    color: var(--color-danger);
  }
  &__actions {
    display: grid;
    gap: var(--space-3);
    margin-top: var(--space-6);
  }
}
</style>
