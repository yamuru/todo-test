import { createNote, getTodo, type Note } from '../models/note'
import type { Todo } from '../models/todo'
import {
  applyChange,
  createHistory,
  finishTextChange,
  redoChange,
  undoChange,
  type History,
} from './history'
import type { Operation } from './operations'

export interface EditorSession {
  readonly note: Note
  readonly history: History
  readonly active: boolean
}

export function startEditing(note: Note): EditorSession {
  return Object.freeze({
    note: createNote(note.id, note.title, note.todos),
    history: createHistory(),
    active: true,
  })
}

export function startCreating(id: string): EditorSession {
  return startEditing(createNote(id))
}

function requireActive(session: EditorSession): void {
  if (!session.active) throw new Error('Editing session has ended')
}

export function applyEditorOperation(
  session: EditorSession,
  operation: Operation,
): EditorSession {
  requireActive(session)
  return Object.freeze({
    ...session,
    ...applyChange(session.note, session.history, operation),
  })
}

export function changeTitle(
  session: EditorSession,
  title: string,
): EditorSession {
  requireActive(session)
  return applyEditorOperation(session, {
    kind: 'title',
    before: session.note.title,
    after: title,
  })
}

export function changeTodoText(
  session: EditorSession,
  todoId: string,
  text: string,
): EditorSession {
  requireActive(session)
  return applyEditorOperation(session, {
    kind: 'todo-text',
    todoId,
    before: getTodo(session.note, todoId).text,
    after: text,
  })
}

export function addTodo(
  session: EditorSession,
  todo: Todo,
  index = session.note.todos.length,
): EditorSession {
  requireActive(session)
  return applyEditorOperation(session, { kind: 'todo-add', todo, index })
}

export function removeTodo(
  session: EditorSession,
  todoId: string,
): EditorSession {
  requireActive(session)
  return applyEditorOperation(session, {
    kind: 'todo-remove',
    todo: getTodo(session.note, todoId),
    index: session.note.todos.findIndex((todo) => todo.id === todoId),
  })
}

export function toggleTodo(
  session: EditorSession,
  todoId: string,
): EditorSession {
  requireActive(session)
  const todo = getTodo(session.note, todoId)
  return applyEditorOperation(session, {
    kind: 'todo-completed',
    todoId,
    before: todo.completed,
    after: !todo.completed,
  })
}

export function finishTextEdit(session: EditorSession): EditorSession {
  requireActive(session)
  return Object.freeze({
    ...session,
    history: finishTextChange(session.history),
  })
}

export function undo(session: EditorSession): EditorSession {
  requireActive(session)
  return Object.freeze({
    ...session,
    ...undoChange(session.note, session.history),
  })
}

export function redo(session: EditorSession): EditorSession {
  requireActive(session)
  return Object.freeze({
    ...session,
    ...redoChange(session.note, session.history),
  })
}

export function clearHistory(session: EditorSession): EditorSession {
  requireActive(session)
  return Object.freeze({ ...session, history: createHistory() })
}

export function finishSession(session: EditorSession): EditorSession {
  return Object.freeze({ ...session, history: createHistory(), active: false })
}
