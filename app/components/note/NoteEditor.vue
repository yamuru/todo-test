<script setup lang="ts">
import ConfirmDialog from '~/components/dialog/ConfirmDialog.vue'
import type { Result } from '~/persistence/result'
import { useEditorStore } from '~/stores/editor'
import { useNotesStore } from '~/stores/notes'

const props = defineProps<{ noteId?: string }>()
const editor = useEditorStore()
const notes = useNotesStore()
const notice = useNotice()
const router = useRouter()
const note = computed(() => (editor.active ? editor.session?.note : undefined))
const existing = computed(() => !!note.value && !!notes.getEntry(note.value.id))
const heading = computed(() =>
  props.noteId || existing.value ? 'Редактирование заметки' : 'Новая заметка',
)
useHead({ title: heading })
const initialized = ref(false)
const openingError = ref('')
const missing = ref(false)
const actionError = ref('')
const newTodo = ref('')
const addError = ref('')
const validation = ref(false)
const busy = ref(false)
const recoveryOpen = ref(false)
const confirmation = ref<'cancel' | 'leave' | 'delete' | 'reload' | null>(null)
const confirmOpen = computed({
  get: () => confirmation.value !== null,
  set: (value: boolean) => {
    if (!value) dismissConfirmation()
  },
})
const dialogError = ref('')
const titleInput = useTemplateRef<{ focus: () => void }>('titleInput')
const addInput = useTemplateRef<{ focus: () => void }>('addInput')
const root = useTemplateRef<HTMLElement>('root')
let resolveLeave: ((allowed: boolean) => void) | undefined
let leaving = false
const { finish: finishText, schedule: scheduleTextEdit } = useTextEditBoundary(
  () => {
    if (editor.active) editor.finishTextEdit()
  },
)

const titleError = computed(() =>
  validation.value && !note.value?.title.trim()
    ? 'Введите название заметки'
    : '',
)
const confirmTitle = computed(
  () =>
    ({
      cancel: 'Отменить редактирование?',
      leave: 'Выйти без сохранения?',
      delete: 'Удалить заметку?',
      reload: 'Загрузить актуальную версию?',
    })[confirmation.value ?? 'cancel'],
)
const confirmDescription = computed(() => {
  if (confirmation.value === 'delete')
    return `Заметка «${note.value?.title ?? ''}» и её задачи будут удалены. Восстановить их будет нельзя.`
  if (confirmation.value === 'reload')
    return 'Текущая рабочая копия и её черновик будут отброшены. Откроется версия, сохранённая в другой вкладке.'
  return 'Несохранённые изменения и черновик этой сессии будут удалены. Сохранённая заметка останется без изменений.'
})
const confirmLabel = computed(
  () =>
    ({
      cancel: 'Отменить',
      leave: 'Выйти без сохранения',
      delete: 'Удалить заметку',
      reload: 'Загрузить актуальную версию',
    })[confirmation.value ?? 'cancel'],
)

function report<T>(result: Result<T>) {
  if (!result.ok) actionError.value = result.error.message
  return result.ok
}
function textChanged(action: () => Result<void>) {
  actionError.value = ''
  report(action())
  scheduleTextEdit()
}
function atomic(action: () => Result<void>) {
  finishText()
  actionError.value = ''
  report(action())
}
async function focusTitle() {
  await nextTick()
  titleInput.value?.focus()
}
function ready() {
  openingError.value = ''
  missing.value = false
  recoveryOpen.value = false
  focusTitle()
}
function startNew() {
  recoveryOpen.value = false
  editor.dismissRecovery()
  const result = editor.createNew()
  if (!result.ok) openingError.value = result.error.message
  else ready()
}
function initialize() {
  openingError.value = ''
  missing.value = false
  notice.value = ''
  let result: Result<unknown>
  if (props.noteId) result = editor.openNote(props.noteId)
  else {
    const loaded = notes.load()
    if (!loaded.ok) result = loaded
    else {
      const drafts = editor.discoverDrafts()
      if (!drafts.ok) result = drafts
      else if (drafts.value.length) result = editor.offerRecovery()
      else result = editor.createNew()
    }
  }
  initialized.value = true
  if (editor.recoveryChoices.length) recoveryOpen.value = true
  else if (!result.ok) {
    missing.value = result.error.code === 'not-found'
    openingError.value = result.error.message
  } else ready()
}
function afterEmptyRecovery() {
  editor.dismissRecovery()
  initialize()
}
async function addTodo() {
  if (!newTodo.value.trim()) {
    addError.value = 'Введите текст задачи'
    addInput.value?.focus()
    return
  }
  finishText()
  const result = editor.addTodo(newTodo.value)
  if (!report(result)) return
  newTodo.value = ''
  addError.value = ''
  await nextTick()
  addInput.value?.focus()
}
async function removeTodo(id: string) {
  const index = note.value?.todos.findIndex((todo) => todo.id === id) ?? 0
  atomic(() => editor.removeTodo(id))
  await nextTick()
  const textareas =
    root.value?.querySelectorAll<HTMLTextAreaElement>('textarea')
  const next = textareas?.[Math.min(index, (textareas?.length ?? 0) - 1)]
  if (next) next.focus()
  else addInput.value?.focus()
}
function ask(kind: NonNullable<typeof confirmation.value>) {
  finishText()
  dialogError.value = ''
  confirmation.value = kind
}
function dismissConfirmation() {
  confirmation.value = null
  resolveLeave?.(false)
  resolveLeave = undefined
}
async function save() {
  if (busy.value || !editor.active || editor.conflict) return
  finishText()
  validation.value = true
  if (titleError.value) {
    titleInput.value?.focus()
    return
  }
  if (newTodo.value.trim()) {
    addError.value = 'Добавьте задачу или очистите поле перед сохранением'
    addInput.value?.focus()
    return
  }
  const emptyIndex =
    note.value?.todos.findIndex((todo) => !todo.text.trim()) ?? -1
  if (emptyIndex >= 0) {
    await nextTick()
    root.value
      ?.querySelectorAll<HTMLTextAreaElement>('textarea')
      [emptyIndex]?.focus()
    return
  }
  busy.value = true
  actionError.value = ''
  const result = editor.save()
  busy.value = false
  if (!report(result)) return
  notice.value = 'Заметка сохранена'
  leaving = true
  await router.push('/')
}
async function confirm() {
  if (busy.value || !confirmation.value) return
  busy.value = true
  const kind = confirmation.value
  if (kind === 'delete') {
    const id = note.value?.id
    if (!id) {
      busy.value = false
      return
    }
    const removed = notes.deleteNote(id)
    if (!removed.ok) {
      dialogError.value = removed.error.message
      busy.value = false
      return
    }
    // Deletion is committed even if cleaning this session's draft needs a retry.
    const cancelled = editor.cancel()
    if (!cancelled.ok) {
      dialogError.value =
        'Заметка удалена, но черновик не удалось очистить. Повторите выход без сохранения.'
      confirmation.value = 'leave'
      busy.value = false
      return
    }
    notice.value = 'Заметка удалена'
  } else {
    const result = kind === 'reload' ? editor.reloadLatest() : editor.cancel()
    if (!result.ok) {
      dialogError.value = result.error.message
      busy.value = false
      return
    }
  }
  confirmation.value = null
  busy.value = false
  if (kind === 'reload') {
    actionError.value = ''
    validation.value = false
    ready()
    return
  }
  leaving = true
  if (resolveLeave) {
    resolveLeave(true)
    resolveLeave = undefined
  } else await router.push('/')
}
function guardLeave(): boolean | Promise<boolean> {
  if (leaving) return true
  finishText()
  if (!editor.active) {
    editor.dismissRecovery()
    return true
  }
  if (!editor.dirty && !newTodo.value.trim()) return report(editor.cancel())
  if (resolveLeave) return false
  ask('leave')
  return new Promise((resolve) => {
    resolveLeave = resolve
  })
}
onBeforeRouteLeave(guardLeave)
onBeforeRouteUpdate((to, from) =>
  to.params.id !== from.params.id ? guardLeave() : true,
)

onMounted(initialize)
useEditorShortcuts({
  enabled: () => editor.active,
  undo: () => atomic(() => editor.undo()),
  redo: () => atomic(() => editor.redo()),
})
onBeforeUnmount(() => {
  resolveLeave?.(false)
  if (!editor.active) editor.dismissRecovery()
})
</script>

<template>
  <section ref="root" class="editor" aria-labelledby="editor-heading">
    <NuxtLink to="/" class="editor__back"
      ><UiIcon name="back" />К заметкам</NuxtLink
    >
    <h1 id="editor-heading" tabindex="-1">
      {{ missing ? 'Заметка не найдена' : heading }}
    </h1>
    <p v-if="!initialized" role="status">Загрузка заметки…</p>
    <div v-else-if="openingError" class="editor__message" role="alert">
      <p>{{ openingError }}</p>
      <UiButton v-if="!missing" variant="secondary" @click="initialize"
        >Повторить загрузку</UiButton
      >
    </div>
    <div
      v-if="!editor.active && editor.recoveryChoices.length"
      class="editor__message"
    >
      <p>Найдены незавершённые черновики</p>
      <UiButton @click="recoveryOpen = true">Выбрать черновик</UiButton>
      <UiButton v-if="!noteId" variant="secondary" @click="startNew"
        >Создать новую заметку</UiButton
      >
    </div>
    <template v-if="note">
      <div
        v-if="notes.error"
        class="editor__message editor__message--error"
        role="alert"
      >
        <p>
          Не удалось обновить сохранённые заметки. {{ notes.error.message }}
        </p>
        <UiButton variant="secondary" @click="notes.load()"
          >Повторить загрузку</UiButton
        >
      </div>
      <div
        v-if="editor.conflict"
        class="editor__message editor__message--error"
        role="alert"
      >
        <p v-if="editor.conflict === 'deleted'">
          Заметка была удалена в другой вкладке. Ваш текст остаётся доступным
          для копирования. Сохранить эту заметку нельзя.
        </p>
        <p v-else>
          Заметка была изменена в другой вкладке. Ваша рабочая копия не
          изменена. Для продолжения загрузите актуальную версию.
        </p>
        <UiButton
          v-if="editor.conflict === 'changed'"
          variant="secondary"
          @click="ask('reload')"
          >Загрузить актуальную версию</UiButton
        >
        <NuxtLink v-else to="/">К заметкам</NuxtLink>
      </div>
      <div
        v-if="editor.draftState.status === 'error'"
        class="editor__message editor__message--error"
        role="alert"
      >
        <p>
          Не удалось записать черновик на устройстве.
          {{ editor.draftState.error.message }}. Текст остаётся в редакторе.
        </p>
        <UiButton variant="secondary" @click="report(editor.flushDraft())"
          >Повторить запись черновика</UiButton
        >
      </div>
      <form class="editor__form" novalidate @submit.prevent="save">
        <div class="editor__surface">
          <UiTextField
            ref="titleInput"
            :model-value="note.title"
            label="Название"
            required
            autocomplete="off"
            :error="titleError"
            @update:model-value="textChanged(() => editor.changeTitle($event))"
            @blur="finishText"
          />
          <div class="editor__section-heading">
            <h2>Задачи</h2>
            <div
              class="editor__history"
              role="group"
              aria-label="История изменений"
            >
              <UiIconButton
                label="Отменить изменение"
                title="Отменить изменение (Ctrl/Cmd+Z вне текстовых полей)"
                :disabled="!editor.undoAvailable || busy"
                @click="atomic(() => editor.undo())"
                ><UiIcon name="undo"
              /></UiIconButton>
              <UiIconButton
                label="Повторить изменение"
                title="Повторить изменение (Ctrl/Cmd+Shift+Z вне текстовых полей)"
                :disabled="!editor.redoAvailable || busy"
                @click="atomic(() => editor.redo())"
                ><UiIcon name="redo"
              /></UiIconButton>
            </div>
          </div>
          <ul v-if="note.todos.length" class="editor__todos">
            <TodoItem
              v-for="(todo, index) in note.todos"
              :key="todo.id"
              :todo="todo"
              :index="index"
              :error="
                validation && !todo.text.trim()
                  ? 'Введите текст задачи или удалите её'
                  : ''
              "
              @text="textChanged(() => editor.changeTodoText(todo.id, $event))"
              @toggle="atomic(() => editor.toggleTodo(todo.id))"
              @delete="removeTodo(todo.id)"
              @finish="finishText"
            />
          </ul>
          <p v-else class="editor__muted">Нет задач</p>
          <div class="editor__add">
            <UiTextField
              ref="addInput"
              v-model="newTodo"
              label="Новая задача"
              :error="addError"
              autocomplete="off"
              @update:model-value="addError = ''"
              @keydown.enter.prevent="!$event.isComposing && addTodo()"
            />
            <UiButton variant="secondary" @click="addTodo"
              ><UiIcon name="plus" />Добавить задачу</UiButton
            >
          </div>
        </div>
        <p v-if="actionError" class="editor__error" role="alert">
          {{ actionError }}
        </p>
        <footer class="editor__actions">
          <UiButton
            v-if="existing"
            class="editor__delete"
            variant="secondary"
            :disabled="busy"
            @click="ask('delete')"
            >Удалить заметку</UiButton
          >
          <div class="editor__save-actions">
            <UiButton
              variant="secondary"
              :disabled="busy"
              @click="ask('cancel')"
              >Отменить</UiButton
            >
            <UiButton
              type="submit"
              :disabled="
                busy || !!editor.conflict || (existing && !editor.dirty)
              "
              >Сохранить</UiButton
            >
          </div>
        </footer>
      </form>
    </template>
    <NoteRecovery
      v-model="recoveryOpen"
      :note-id="noteId"
      @ready="ready"
      @empty="afterEmptyRecovery"
      @create="startNew"
    />
    <ConfirmDialog
      v-model="confirmOpen"
      :title="confirmTitle"
      :description="confirmDescription"
      :confirm-label="confirmLabel"
      :danger="confirmation !== 'reload'"
      :error="dialogError"
      :busy="busy"
      @confirm="confirm"
    />
  </section>
</template>

<style scoped lang="scss">
.editor {
  max-width: var(--layout-editor);
  margin-inline: auto;
  &__back {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    min-height: var(--control-size-sm);
    margin-bottom: var(--space-5);
  }
  h1 {
    font-size: clamp(2rem, 1.5rem + 1.5vw, 2.5rem);
    margin-block: var(--space-5) var(--space-8);
  }
  &__surface {
    padding: var(--space-4);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    background: var(--color-surface);
  }
  &__section-heading {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-4);
    margin-block: var(--space-8) var(--space-5);
  }
  &__history {
    display: flex;
    gap: var(--space-2);
  }
  &__todos {
    display: grid;
    gap: var(--space-4);
    margin: 0;
    padding: 0;
    list-style: none;
  }
  &__muted {
    color: var(--color-text-secondary);
  }
  &__add {
    display: grid;
    align-items: end;
    gap: var(--space-3);
    margin-top: var(--space-6);
    padding-top: var(--space-6);
    border-top: 1px solid var(--color-border);
  }
  &__actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-4);
    margin-top: var(--space-6);
  }
  &__delete {
    color: var(--color-danger);
  }
  &__save-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-3);
    margin-left: auto;
  }
  &__error {
    margin-top: var(--space-4);
    color: var(--color-danger);
  }
  &__message {
    display: grid;
    justify-items: start;
    gap: var(--space-4);
    margin-block: var(--space-6);
    padding: var(--space-5);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    background: var(--color-surface);
  }
  &__message--error {
    border-color: var(--color-danger);
  }
  @media (min-width: 40rem) {
    &__surface {
      padding: var(--space-8);
    }
    &__add {
      grid-template-columns: minmax(0, 1fr) auto;
    }
  }
  @media (max-width: 30rem) {
    &__actions {
      flex-direction: column-reverse;
      align-items: stretch;
    }
    &__save-actions {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      margin: 0;
    }
  }
}
</style>
