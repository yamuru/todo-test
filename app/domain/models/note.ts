import { createTodo, type Todo } from './todo'

export interface Note {
  readonly id: string
  readonly title: string
  readonly todos: readonly Todo[]
}

export function createNote(
  id: string,
  title = '',
  todos: readonly Todo[] = [],
): Note {
  if (!id.trim()) throw new Error('Note ID must not be empty')
  if (new Set(todos.map((todo) => todo.id)).size !== todos.length) {
    throw new Error('Todo IDs must be unique within a note')
  }
  return Object.freeze({
    id,
    title,
    todos: Object.freeze(
      todos.map((todo) => createTodo(todo.id, todo.text, todo.completed)),
    ),
  })
}

export function getTodo(note: Note, id: string): Todo {
  const todo = note.todos.find((todo) => todo.id === id)
  if (!todo) throw new Error(`Todo not found: ${id}`)
  return todo
}
