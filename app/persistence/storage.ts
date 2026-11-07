import type { Note } from '../domain/models/note'
import {
  decodeCollection,
  decodeDraft,
  encodeDraft,
  encodeNotes,
  type Collection,
  type Draft,
  type SavedNote,
} from './codec'
import {
  failure,
  storageFailure,
  success,
  type AppError,
  type Result,
} from './result'

export const NOTES_KEY = 'todo-test:notes'
export const DRAFT_PREFIX = 'todo-test:draft:'

export interface StoragePort {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface DraftIdentity {
  readonly noteId: string
  readonly sessionId: string
  readonly ownerId: string
}

export type RecoveryConflict = 'changed' | 'deleted'

export interface DraftCandidate {
  readonly id: string
  readonly noteId: string | null
  readonly raw: string
  readonly draft: Draft | null
  readonly error: AppError | null
  readonly conflict: RecoveryConflict | null
}

export function draftKey(id: string, sessionId: string): string {
  return (
    DRAFT_PREFIX + encodeURIComponent(id) + ':' + encodeURIComponent(sessionId)
  )
}

export function createPersistence(
  getStorage: () => StoragePort | null,
  newRevision: () => string = () => crypto.randomUUID(),
) {
  function access<T>(action: (storage: StoragePort) => Result<T>): Result<T> {
    try {
      const storage = getStorage()
      if (!storage)
        return failure('unavailable', 'Локальное хранилище недоступно')
      return action(storage)
    } catch (error) {
      return storageFailure(error)
    }
  }

  function readCollection(storage: StoragePort): Result<Collection> {
    const raw = storage.getItem(NOTES_KEY)
    return raw === null
      ? success({ notes: Object.freeze([]), deletedNoteIds: Object.freeze([]) })
      : decodeCollection(raw)
  }

  function loadNotes(): Result<readonly SavedNote[]> {
    return access((storage) => {
      const collection = readCollection(storage)
      return collection.ok ? success(collection.value.notes) : collection
    })
  }

  function saveNote(
    note: Note,
    expectedRevision: string | null,
  ): Result<readonly SavedNote[]> {
    return access((storage) => {
      const latest = readCollection(storage)
      if (!latest.ok) return latest
      if (latest.value.deletedNoteIds.includes(note.id))
        return failure('not-found', 'Этот ID принадлежит удалённой заметке')
      const current = latest.value.notes.find(
        (entry) => entry.note.id === note.id,
      )
      if (expectedRevision !== null && !current)
        return failure('not-found', 'Заметка была удалена')
      if ((current?.revision ?? null) !== expectedRevision)
        return failure('conflict', 'Заметка была изменена в другой сессии')
      if (!note.title.trim() || note.todos.some((todo) => !todo.text.trim()))
        return failure(
          'validation',
          'Название и текст задач не должны быть пустыми',
        )
      const saved = { note, revision: newRevision() }
      const next = current
        ? latest.value.notes.map((entry) =>
            entry.note.id === note.id ? saved : entry,
          )
        : [...latest.value.notes, saved]
      const raw = encodeNotes(next, latest.value.deletedNoteIds)
      const checked = decodeCollection(raw)
      if (!checked.ok) return checked
      storage.setItem(NOTES_KEY, raw)
      return success(checked.value.notes)
    })
  }

  function deleteNote(
    id: string,
    expectedRevision: string,
  ): Result<readonly SavedNote[]> {
    return access((storage) => {
      const latest = readCollection(storage)
      if (!latest.ok) return latest
      const current = latest.value.notes.find((entry) => entry.note.id === id)
      if (!current)
        return failure('not-found', 'Заметка не найдена или уже удалена')
      if (current.revision !== expectedRevision)
        return failure('conflict', 'Заметка изменилась перед удалением')
      const next = latest.value.notes.filter((entry) => entry.note.id !== id)
      storage.setItem(
        NOTES_KEY,
        encodeNotes(next, [...latest.value.deletedNoteIds, id]),
      )
      return success(Object.freeze(next))
    })
  }

  function draftConflict(
    draft: Draft,
    collection: Collection,
  ): RecoveryConflict | null {
    if (collection.deletedNoteIds.includes(draft.note.id)) return 'deleted'
    const current = collection.notes.find(
      (entry) => entry.note.id === draft.note.id,
    )
    if (draft.baseRevision !== null && !current) return 'deleted'
    if ((current?.revision ?? null) !== draft.baseRevision) return 'changed'
    return null
  }

  function findDrafts(noteId?: string): Result<readonly DraftCandidate[]> {
    return access((storage) => {
      const collection = readCollection(storage)
      if (!collection.ok) return collection
      const candidates: DraftCandidate[] = []
      for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index)
        if (!key?.startsWith(DRAFT_PREFIX)) continue
        let keyNoteId: string | null = null
        try {
          keyNoteId = decodeURIComponent(
            key.slice(DRAFT_PREFIX.length).split(':')[0]!,
          )
        } catch {
          /* Report malformed keys as unreadable candidates. */
        }
        if (noteId !== undefined && keyNoteId !== noteId) continue
        const raw = storage.getItem(key)
        if (raw === null) continue
        let decoded = decodeDraft(raw)
        if (
          decoded.ok &&
          (decoded.value.note.id !== keyNoteId ||
            draftKey(decoded.value.note.id, decoded.value.sessionId) !== key)
        )
          decoded = failure(
            'invalid-data',
            'Идентификатор черновика не совпадает с ключом',
          )
        candidates.push(
          Object.freeze({
            id: key,
            noteId: keyNoteId,
            raw,
            draft: decoded.ok ? decoded.value : null,
            error: decoded.ok ? null : decoded.error,
            conflict: decoded.ok
              ? draftConflict(decoded.value, collection.value)
              : null,
          }),
        )
      }
      return success(Object.freeze(candidates))
    })
  }

  function saveDraft(draft: Draft): Result<void> {
    return access((storage) => {
      const key = draftKey(draft.note.id, draft.sessionId)
      const previous = storage.getItem(key)
      if (previous !== null) {
        const decoded = decodeDraft(previous)
        if (!decoded.ok) return decoded
        if (decoded.value.ownerId !== draft.ownerId)
          return failure('conflict', 'Черновик восстановлен другой сессией')
      }
      const raw = encodeDraft(draft)
      const checked = decodeDraft(raw)
      if (!checked.ok) return checked
      storage.setItem(key, raw)
      return success(undefined)
    })
  }

  function removeDraft(identity: DraftIdentity): Result<void> {
    return access((storage) => {
      const key = draftKey(identity.noteId, identity.sessionId)
      const raw = storage.getItem(key)
      if (raw === null) return success(undefined)
      const draft = decodeDraft(raw)
      if (!draft.ok) return draft
      if (draft.value.ownerId !== identity.ownerId)
        return failure('conflict', 'Черновик принадлежит другой сессии')
      storage.removeItem(key)
      return success(undefined)
    })
  }

  function discardDraft(candidate: DraftCandidate): Result<void> {
    return access((storage) => {
      const current = storage.getItem(candidate.id)
      if (current === null) return success(undefined)
      if (current !== candidate.raw)
        return failure('conflict', 'Черновик изменился; повторите выбор')
      storage.removeItem(candidate.id)
      return success(undefined)
    })
  }

  function claimDraft(
    candidate: DraftCandidate,
    ownerId: string,
  ): Result<Draft> {
    return access((storage) => {
      const draft = candidate.draft
      if (!draft)
        return failure('invalid-data', 'Выбранный черновик нельзя прочитать')
      if (storage.getItem(candidate.id) !== candidate.raw)
        return failure('conflict', 'Черновик изменился; повторите выбор')
      const claimed = Object.freeze({ ...draft, ownerId })
      storage.setItem(candidate.id, encodeDraft(claimed))
      return success(claimed)
    })
  }

  return {
    loadNotes,
    saveNote,
    deleteNote,
    findDrafts,
    saveDraft,
    removeDraft,
    discardDraft,
    claimDraft,
  }
}

export type Persistence = ReturnType<typeof createPersistence>

export const browserPersistence = createPersistence(() =>
  typeof window === 'undefined' ? null : window.localStorage,
)
