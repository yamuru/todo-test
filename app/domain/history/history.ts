import type { Note } from '../models/note'
import {
  applyOperation,
  copyOperation,
  isTextOperation,
  type Operation,
  type TextOperation,
} from './operations'

export const HISTORY_LIMIT = 50

export interface History {
  readonly undoStack: readonly Operation[]
  readonly redoStack: readonly Operation[]
  readonly pendingText: TextOperation | null
}

function historyState(
  undoStack: readonly Operation[] = [],
  redoStack: readonly Operation[] = [],
  pendingText: TextOperation | null = null,
): History {
  return Object.freeze({
    undoStack: Object.freeze([...undoStack]),
    redoStack: Object.freeze([...redoStack]),
    pendingText,
  })
}

export function createHistory(): History {
  return historyState()
}

function append(
  stack: readonly Operation[],
  operation: Operation,
): readonly Operation[] {
  return [...stack, copyOperation(operation)].slice(-HISTORY_LIMIT)
}

export function finishTextChange(history: History): History {
  const pending = history.pendingText
  if (!pending) return history
  return historyState(append(history.undoStack, pending), history.redoStack)
}

export function canUndo(history: History): boolean {
  return history.pendingText !== null || history.undoStack.length > 0
}

export function canRedo(history: History): boolean {
  return history.redoStack.length > 0
}

function sameTextField(first: TextOperation, second: TextOperation): boolean {
  return (
    first.kind === second.kind &&
    (first.kind === 'title' ||
      (second.kind === 'todo-text' && first.todoId === second.todoId))
  )
}

export function applyChange(
  note: Note,
  history: History,
  operation: Operation,
): { note: Note; history: History } {
  const nextNote = applyOperation(note, operation)

  if (isTextOperation(operation)) {
    const pending = history.pendingText
    const sameField = pending !== null && sameTextField(pending, operation)
    const committed = sameField ? history : finishTextChange(history)
    if (nextNote === note) return { note, history: committed }
    const merged = Object.freeze({
      ...operation,
      before: sameField ? pending.before : operation.before,
    })
    return {
      note: nextNote,
      history: historyState(
        committed.undoStack,
        [],
        merged.before === merged.after ? null : merged,
      ),
    }
  }

  if (nextNote === note) return { note, history }
  const committed = finishTextChange(history)
  return {
    note: nextNote,
    history: historyState(append(committed.undoStack, operation)),
  }
}

export function undoChange(
  note: Note,
  history: History,
): { note: Note; history: History } {
  const committed = finishTextChange(history)
  const operation = committed.undoStack.at(-1)
  if (!operation) return { note, history: committed }
  return {
    note: applyOperation(note, operation, 'inverse'),
    history: historyState(
      committed.undoStack.slice(0, -1),
      append(committed.redoStack, operation),
    ),
  }
}

export function redoChange(
  note: Note,
  history: History,
): { note: Note; history: History } {
  const committed = finishTextChange(history)
  const operation = committed.redoStack.at(-1)
  if (!operation) return { note, history: committed }
  return {
    note: applyOperation(note, operation),
    history: historyState(
      append(committed.undoStack, operation),
      committed.redoStack.slice(0, -1),
    ),
  }
}
