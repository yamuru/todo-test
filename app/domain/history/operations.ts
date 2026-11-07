import { createNote, getTodo, type Note } from '../models/note'
import { createTodo, type Todo } from '../models/todo'

export type TextOperation =
  | { readonly kind: 'title'; readonly before: string; readonly after: string }
  | {
      readonly kind: 'todo-text'
      readonly todoId: string
      readonly before: string
      readonly after: string
    }

export type Operation =
  | TextOperation
  | {
      readonly kind: 'todo-completed'
      readonly todoId: string
      readonly before: boolean
      readonly after: boolean
    }
  | { readonly kind: 'todo-add'; readonly todo: Todo; readonly index: number }
  | {
      readonly kind: 'todo-remove'
      readonly todo: Todo
      readonly index: number
    }

export function isTextOperation(
  operation: Operation,
): operation is TextOperation {
  return operation.kind === 'title' || operation.kind === 'todo-text'
}

export function copyOperation(operation: Operation): Operation {
  if (operation.kind === 'todo-add' || operation.kind === 'todo-remove') {
    const { id, text, completed } = operation.todo
    return Object.freeze({
      ...operation,
      todo: createTodo(id, text, completed),
    })
  }
  return Object.freeze({ ...operation })
}

function expectValue(
  actual: string | boolean,
  expected: string | boolean,
): void {
  if (actual !== expected)
    throw new Error('Operation does not match the current value')
}

export function applyOperation(
  note: Note,
  operation: Operation,
  direction: 'forward' | 'inverse' = 'forward',
): Note {
  const forward = direction === 'forward'
  switch (operation.kind) {
    case 'title': {
      const before = forward ? operation.before : operation.after
      const after = forward ? operation.after : operation.before
      expectValue(note.title, before)
      return before === after ? note : createNote(note.id, after, note.todos)
    }
    case 'todo-text':
    case 'todo-completed': {
      const todo = getTodo(note, operation.todoId)
      const before = forward ? operation.before : operation.after
      const after = forward ? operation.after : operation.before
      expectValue(
        operation.kind === 'todo-text' ? todo.text : todo.completed,
        before,
      )
      if (before === after) return note
      const replacement =
        operation.kind === 'todo-text'
          ? createTodo(
              todo.id,
              forward ? operation.after : operation.before,
              todo.completed,
            )
          : createTodo(
              todo.id,
              todo.text,
              forward ? operation.after : operation.before,
            )
      return createNote(
        note.id,
        note.title,
        note.todos.map((item) => (item.id === todo.id ? replacement : item)),
      )
    }
    case 'todo-add':
    case 'todo-remove': {
      const insert = (operation.kind === 'todo-add') === forward
      const { index, todo } = operation
      const maxIndex = insert ? note.todos.length : note.todos.length - 1
      if (!Number.isInteger(index) || index < 0 || index > maxIndex) {
        throw new Error('Invalid Todo position')
      }
      const todos = [...note.todos]
      if (insert) {
        if (todos.some((item) => item.id === todo.id))
          throw new Error(`Duplicate Todo ID: ${todo.id}`)
        todos.splice(index, 0, todo)
      } else {
        const current = getTodo(note, todo.id)
        if (
          todos[index]?.id !== todo.id ||
          current.text !== todo.text ||
          current.completed !== todo.completed
        ) {
          throw new Error('Operation does not match the Todo at this position')
        }
        todos.splice(index, 1)
      }
      return createNote(note.id, note.title, todos)
    }
    default: {
      const unreachable: never = operation
      throw new Error(`Unknown operation: ${String(unreachable)}`)
    }
  }
}
