import { defineStore } from 'pinia'
import { computed, onScopeDispose, shallowRef } from 'vue'
import * as domain from '../domain/history/editor-session'
import { canRedo, canUndo } from '../domain/history/history'
import { createNote, type Note } from '../domain/models/note'
import { createTodo } from '../domain/models/todo'
import type { Draft } from '../persistence/codec'
import { createDebouncedWrite } from '../persistence/debounce'
import {
  browserPersistence,
  type Persistence,
  type DraftIdentity,
  type DraftCandidate,
  type RecoveryConflict,
} from '../persistence/storage'
import {
  failure,
  success,
  type AppError,
  type Result,
} from '../persistence/result'
import { useNotesStore, type NotesStore } from './notes'

type DraftState =
  | { readonly status: 'idle' | 'pending' | 'written' }
  | { readonly status: 'error'; readonly error: AppError }

interface EditorDependencies {
  readonly persistence: Persistence
  readonly notesStore: () => NotesStore
  readonly newId?: () => string
  readonly newSessionId?: () => string
  readonly now?: () => number
}

export function defineEditorStore(
  dependencies: EditorDependencies,
  id = 'editor',
) {
  return defineStore(id, () => {
    const notes = dependencies.notesStore()
    const persistence = dependencies.persistence
    const newId = dependencies.newId ?? (() => crypto.randomUUID())
    const newSessionId =
      dependencies.newSessionId ?? (() => crypto.randomUUID())
    const now = dependencies.now ?? Date.now
    const session = shallowRef<domain.EditorSession | null>(null)
    const baseline = shallowRef<Note | null>(null)
    const baseRevision = shallowRef<string | null>(null)
    const recoveryChoices = shallowRef<readonly DraftCandidate[]>([])
    const selectedRecovery = shallowRef<DraftCandidate | null>(null)
    const recovery = computed<Draft | null>(
      () => selectedRecovery.value?.draft ?? null,
    )
    const recoveryConflict = computed(
      () => selectedRecovery.value?.conflict ?? null,
    )
    const draftIdentity = shallowRef<DraftIdentity | null>(null)
    const cleanupTasks = shallowRef<
      readonly { identity: DraftIdentity; error: AppError }[]
    >([])
    const pendingCleanup = computed(
      () => cleanupTasks.value[0]?.identity ?? null,
    )
    const originConflict = shallowRef<RecoveryConflict | null>(null)
    const draftState = shallowRef<DraftState>({ status: 'idle' })
    const cleanupError = computed(() => cleanupTasks.value[0]?.error ?? null)
    const active = computed(() => session.value?.active === true)
    const conflict = computed<RecoveryConflict | null>(() => {
      if (!active.value || !session.value) return null
      const latest = notes.getEntry(session.value.note.id)
      if (
        !latest &&
        (baseRevision.value !== null || originConflict.value === 'changed')
      )
        return 'deleted'
      if (originConflict.value) return originConflict.value
      return (latest?.revision ?? null) !== baseRevision.value
        ? 'changed'
        : null
    })
    const dirty = computed(
      () =>
        active.value &&
        (conflict.value !== null ||
          JSON.stringify(session.value?.note) !==
            JSON.stringify(baseline.value)),
    )
    const undoAvailable = computed(
      () => active.value && !!session.value && canUndo(session.value.history),
    )
    const redoAvailable = computed(
      () => active.value && !!session.value && canRedo(session.value.history),
    )

    function writeDraft(): Result<void> {
      if (!active.value || !session.value || !draftIdentity.value)
        return success(undefined)
      session.value = domain.finishTextEdit(session.value)
      const result = dirty.value
        ? persistence.saveDraft({
            note: session.value.note,
            baseRevision: baseRevision.value,
            updatedAt: now(),
            sessionId: draftIdentity.value.sessionId,
            ownerId: draftIdentity.value.ownerId,
          })
        : persistence.removeDraft(draftIdentity.value)
      draftState.value = result.ok
        ? { status: dirty.value ? 'written' : 'idle' }
        : { status: 'error', error: result.error }
      return result
    }
    const debounce = createDebouncedWrite(writeDraft)
    onScopeDispose(debounce.cancel)

    function flushDraft(): Result<void> {
      debounce.cancel()
      return writeDraft()
    }

    function begin(
      note: Note,
      revision: string | null,
      identity?: DraftIdentity,
    ) {
      debounce.cancel()
      session.value = domain.startEditing(note)
      baseline.value = note
      baseRevision.value = revision
      recoveryChoices.value = []
      selectedRecovery.value = null
      const sessionId = identity?.sessionId ?? newSessionId()
      draftIdentity.value = identity ?? {
        noteId: note.id,
        sessionId,
        ownerId: sessionId,
      }
      originConflict.value = null
      draftState.value = { status: 'idle' }
    }

    function checkCanOpen(): Result<void> {
      if (active.value)
        return failure('busy', 'Сначала завершите текущую сессию')
      if (recoveryChoices.value.length)
        return failure(
          'recovery-pending',
          'Сначала выберите действие для найденного черновика',
        )
      return success(undefined)
    }

    function openNote(noteId: string): Result<void> {
      const available = checkCanOpen()
      if (!available.ok) return available
      const loaded = notes.load()
      if (!loaded.ok) return loaded
      const offered = offerDrafts(noteId)
      if (!offered.ok || recoveryChoices.value.length) return offered
      const entry = notes.getEntry(noteId)
      if (!entry) return failure('not-found', 'Заметка не найдена')
      begin(entry.note, entry.revision)
      return success(undefined)
    }

    function createNew(): Result<string> {
      const available = checkCanOpen()
      if (!available.ok) return available
      const loaded = notes.load()
      if (!loaded.ok) return loaded
      const noteId = newId()
      if (notes.getEntry(noteId))
        return failure('conflict', 'ID новой заметки уже существует')
      const offered = offerDrafts(noteId)
      if (!offered.ok) return offered
      if (!recoveryChoices.value.length) begin(createNote(noteId), null)
      return success(noteId)
    }

    function discoverDrafts() {
      return persistence.findDrafts()
    }

    function offerDrafts(noteId: string): Result<void> {
      const found = persistence.findDrafts(noteId)
      if (!found.ok) return found
      recoveryChoices.value = found.value
      selectedRecovery.value = found.value.length === 1 ? found.value[0]! : null
      return selectedRecovery.value?.error
        ? { ok: false, error: selectedRecovery.value.error }
        : success(undefined)
    }

    function selectRecovery(draftId: string): Result<void> {
      if (active.value)
        return failure('busy', 'Сначала завершите текущую сессию')
      const candidate = recoveryChoices.value.find(
        (item) => item.id === draftId,
      )
      if (!candidate)
        return failure('not-found', 'Черновик не найден среди предложенных')
      selectedRecovery.value = candidate
      return candidate.error
        ? { ok: false, error: candidate.error }
        : success(undefined)
    }

    function offerRecovery(noteId: string): Result<void> {
      if (active.value)
        return failure('busy', 'Сначала завершите текущую сессию')
      const offered = offerDrafts(noteId)
      if (!offered.ok) return offered
      return recoveryChoices.value.length
        ? success(undefined)
        : failure('not-found', 'Черновик не найден')
    }

    function restoreDraft(): Result<void> {
      const candidate = selectedRecovery.value
      if (!candidate?.draft)
        return failure('not-found', 'Нет черновика для восстановления')
      const loaded = notes.load()
      if (!loaded.ok) return loaded
      const found = persistence.findDrafts(candidate.draft.note.id)
      if (!found.ok) return found
      const current = found.value.find((item) => item.id === candidate.id)
      if (!current || current.raw !== candidate.raw)
        return failure('conflict', 'Черновик изменился; повторите выбор')
      const claimed = persistence.claimDraft(current, newSessionId())
      if (!claimed.ok) return claimed
      const draft = claimed.value
      const latest = notes.getEntry(draft.note.id)
      begin(latest?.note ?? createNote(draft.note.id), draft.baseRevision, {
        noteId: draft.note.id,
        sessionId: draft.sessionId,
        ownerId: draft.ownerId,
      })
      originConflict.value = current.conflict
      session.value = domain.startEditing(draft.note)
      draftState.value = { status: 'written' }
      return success(undefined)
    }

    function editSavedVersion(noteId: string): Result<void> {
      if (active.value)
        return failure('busy', 'Сначала завершите текущую сессию')
      const loaded = notes.load()
      if (!loaded.ok) return loaded
      const latest = notes.getEntry(noteId)
      if (!latest) return failure('not-found', 'Заметка не найдена')
      begin(latest.note, latest.revision)
      return success(undefined)
    }

    function discardRecovery(): Result<void> {
      const candidate = selectedRecovery.value
      if (!candidate)
        return recoveryChoices.value.length
          ? failure('recovery-pending', 'Выберите конкретный черновик')
          : success(undefined)
      const loaded = notes.load()
      if (!loaded.ok) return loaded
      const removed = persistence.discardDraft(candidate)
      if (!removed.ok) return removed
      recoveryChoices.value = recoveryChoices.value.filter(
        (item) => item.id !== candidate.id,
      )
      selectedRecovery.value = null
      const latest = candidate.noteId
        ? notes.getEntry(candidate.noteId)
        : undefined
      if (!recoveryChoices.value.length && latest)
        begin(latest.note, latest.revision)
      return success(undefined)
    }

    function discardCorruptedDraft(draftId: string): Result<void> {
      const candidate = recoveryChoices.value.find(
        (item) => item.id === draftId,
      )
      if (!candidate?.error)
        return failure('not-found', 'Повреждённый черновик не найден')
      const removed = persistence.discardDraft(candidate)
      if (!removed.ok) return removed
      recoveryChoices.value = recoveryChoices.value.filter(
        (item) => item.id !== draftId,
      )
      if (selectedRecovery.value?.id === draftId) selectedRecovery.value = null
      return success(undefined)
    }

    function apply(
      action: (current: domain.EditorSession) => domain.EditorSession,
    ): Result<void> {
      if (!active.value || !session.value || !draftIdentity.value)
        return failure('inactive', 'Нет активной сессии')
      const previous = session.value
      try {
        session.value = action(previous)
      } catch (error) {
        return failure(
          'invalid-data',
          error instanceof Error ? error.message : 'Недопустимая операция',
        )
      }
      if (session.value.note !== previous.note) {
        draftState.value = { status: 'pending' }
        debounce.schedule()
      }
      return success(undefined)
    }

    function changeTitle(title: string) {
      return apply((current) => domain.changeTitle(current, title))
    }
    function changeTodoText(todoId: string, text: string) {
      return apply((current) => domain.changeTodoText(current, todoId, text))
    }
    function addTodo(text = '', index?: number): Result<string> {
      if (!active.value) return failure('inactive', 'Нет активной сессии')
      const todoId = newId()
      const result = apply((current) =>
        domain.addTodo(current, createTodo(todoId, text), index),
      )
      return result.ok ? success(todoId) : result
    }
    function removeTodo(todoId: string) {
      return apply((current) => domain.removeTodo(current, todoId))
    }
    function toggleTodo(todoId: string) {
      return apply((current) => domain.toggleTodo(current, todoId))
    }
    function undo() {
      return apply(domain.undo)
    }
    function redo() {
      return apply(domain.redo)
    }
    function finishTextEdit() {
      return apply(domain.finishTextEdit)
    }

    function end() {
      debounce.cancel()
      if (session.value) session.value = domain.finishSession(session.value)
      draftState.value = { status: 'idle' }
    }

    function save(): Result<{ note: Note; cleanupError: AppError | null }> {
      if (!active.value || !session.value || !draftIdentity.value)
        return failure('inactive', 'Нет активной сессии')
      session.value = domain.finishTextEdit(session.value)
      const loaded = notes.load()
      if (!loaded.ok) return loaded
      if (conflict.value)
        return failure(
          conflict.value === 'deleted' ? 'not-found' : 'conflict',
          conflict.value === 'deleted'
            ? 'Заметка была удалена'
            : 'Заметка была изменена в другой сессии',
        )
      const note = session.value.note
      const saved = notes.saveNote(note, baseRevision.value)
      if (!saved.ok) {
        if (saved.error.code === 'not-found') originConflict.value = 'deleted'
        return saved
      }
      debounce.cancel()
      const removed = persistence.removeDraft(draftIdentity.value)
      if (!removed.ok)
        cleanupTasks.value = [
          ...cleanupTasks.value,
          { identity: draftIdentity.value, error: removed.error },
        ]
      end()
      return success({ note, cleanupError: removed.ok ? null : removed.error })
    }

    function cancel(): Result<void> {
      if (!active.value || !session.value) return success(undefined)
      debounce.cancel()
      const removed = draftIdentity.value
        ? persistence.removeDraft(draftIdentity.value)
        : success(undefined)
      if (!removed.ok) {
        if (removed.error.code === 'conflict') {
          end()
          return success(undefined)
        }
        draftState.value = { status: 'error', error: removed.error }
        return removed
      }
      end()
      return success(undefined)
    }

    function reloadLatest(): Result<void> {
      if (!active.value || !session.value)
        return failure('inactive', 'Нет активной сессии')
      const loaded = notes.load()
      if (!loaded.ok) return loaded
      const latest = notes.getEntry(session.value.note.id)
      if (!latest)
        return failure(
          'not-found',
          'Заметка была удалена; завершите редактирование',
        )
      debounce.cancel()
      const removed = draftIdentity.value
        ? persistence.removeDraft(draftIdentity.value)
        : success(undefined)
      if (!removed.ok) return removed
      begin(latest.note, latest.revision)
      return success(undefined)
    }

    function retryDraftCleanup(
      sessionId = pendingCleanup.value?.sessionId,
    ): Result<void> {
      const task = cleanupTasks.value.find(
        (item) => item.identity.sessionId === sessionId,
      )
      if (!task)
        return sessionId === undefined
          ? success(undefined)
          : failure('not-found', 'Задача очистки не найдена')
      const result = persistence.removeDraft(task.identity)
      cleanupTasks.value = result.ok
        ? cleanupTasks.value.filter((item) => item !== task)
        : cleanupTasks.value.map((item) =>
            item === task ? { ...item, error: result.error } : item,
          )
      return result
    }

    return {
      session,
      active,
      dirty,
      conflict,
      recovery,
      recoveryChoices,
      recoveryConflict,
      draftIdentity,
      pendingCleanup,
      cleanupTasks,
      draftState,
      cleanupError,
      undoAvailable,
      redoAvailable,
      openNote,
      createNew,
      discoverDrafts,
      offerRecovery,
      selectRecovery,
      restoreDraft,
      editSavedVersion,
      discardRecovery,
      discardCorruptedDraft,
      changeTitle,
      changeTodoText,
      addTodo,
      removeTodo,
      toggleTodo,
      undo,
      redo,
      finishTextEdit,
      flushDraft,
      save,
      cancel,
      reloadLatest,
      retryDraftCleanup,
    }
  })
}

export const useEditorStore = defineEditorStore({
  persistence: browserPersistence,
  notesStore: useNotesStore,
})
