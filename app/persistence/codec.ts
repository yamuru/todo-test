import { createNote, type Note } from '../domain/models/note'
import { createTodo } from '../domain/models/todo'
import { failure, success, type Result } from './result'

export const SCHEMA_VERSION = 1

export interface SavedNote {
  readonly note: Note
  readonly revision: string
}

export interface Draft {
  readonly note: Note
  readonly baseRevision: string | null
  readonly updatedAt: number
  readonly sessionId: string
  readonly ownerId: string
}

export interface Collection {
  readonly notes: readonly SavedNote[]
  readonly deletedNoteIds: readonly string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function parseNote(value: unknown, saved: boolean): Note | null {
  if (
    !isObject(value) ||
    !isId(value.id) ||
    typeof value.title !== 'string' ||
    (saved && !value.title.trim()) ||
    !Array.isArray(value.todos)
  )
    return null
  const todos = []
  const ids = new Set<string>()
  for (const todo of value.todos) {
    if (
      !isObject(todo) ||
      !isId(todo.id) ||
      ids.has(todo.id) ||
      typeof todo.text !== 'string' ||
      (saved && !todo.text.trim()) ||
      typeof todo.completed !== 'boolean'
    )
      return null
    ids.add(todo.id)
    todos.push(createTodo(todo.id, todo.text, todo.completed))
  }
  return createNote(value.id, value.title, todos)
}

function decodeEnvelope(raw: string): Result<Record<string, unknown>> {
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return failure(
      'invalid-json',
      'Данные хранилища содержат повреждённый JSON',
    )
  }
  if (!isObject(value) || !('schemaVersion' in value))
    return failure('invalid-data', 'Отсутствует версия формата данных')
  if (value.schemaVersion !== SCHEMA_VERSION)
    return failure(
      'unsupported-version',
      'Версия формата данных не поддерживается',
    )
  return success(value)
}

export function decodeCollection(raw: string): Result<Collection> {
  const envelope = decodeEnvelope(raw)
  if (!envelope.ok) return envelope
  if (!Array.isArray(envelope.value.notes))
    return failure('invalid-data', 'Недопустимая структура коллекции заметок')
  const notes: SavedNote[] = []
  const ids = new Set<string>()
  for (const entry of envelope.value.notes) {
    if (!isObject(entry) || !isId(entry.revision))
      return failure('invalid-data', 'Недопустимая ревизия заметки')
    const note = parseNote(entry.note, true)
    if (!note || ids.has(note.id))
      return failure('invalid-data', 'Недопустимая или повторяющаяся заметка')
    ids.add(note.id)
    notes.push(Object.freeze({ note, revision: entry.revision }))
  }
  const deletedIds = envelope.value.deletedNoteIds
  if (
    !Array.isArray(deletedIds) ||
    !deletedIds.every(isId) ||
    new Set(deletedIds).size !== deletedIds.length ||
    deletedIds.some((id) => ids.has(id))
  )
    return failure('invalid-data', 'Недопустимый список удалённых заметок')
  return success(
    Object.freeze({
      notes: Object.freeze(notes),
      deletedNoteIds: Object.freeze([...deletedIds]),
    }),
  )
}

export function encodeNotes(
  notes: readonly SavedNote[],
  deletedNoteIds: readonly string[] = [],
): string {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    notes,
    deletedNoteIds,
  })
}

export function decodeDraft(raw: string): Result<Draft> {
  const envelope = decodeEnvelope(raw)
  if (!envelope.ok) return envelope
  const draft = envelope.value.draft
  if (
    !isObject(draft) ||
    !(draft.baseRevision === null || isId(draft.baseRevision)) ||
    typeof draft.updatedAt !== 'number' ||
    !Number.isFinite(draft.updatedAt) ||
    draft.updatedAt < 0
  )
    return failure('invalid-data', 'Недопустимые метаданные черновика')
  const note = parseNote(draft.note, false)
  if (!note) return failure('invalid-data', 'Недопустимая структура черновика')
  if (!isId(draft.sessionId) || !isId(draft.ownerId))
    return failure('invalid-data', 'Недопустимый владелец черновика')
  return success(
    Object.freeze({
      note,
      baseRevision: draft.baseRevision,
      updatedAt: draft.updatedAt,
      sessionId: draft.sessionId,
      ownerId: draft.ownerId,
    }),
  )
}

export function encodeDraft(draft: Draft): string {
  return JSON.stringify({ schemaVersion: SCHEMA_VERSION, draft })
}
