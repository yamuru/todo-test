export interface Todo {
  readonly id: string
  readonly text: string
  readonly completed: boolean
}

export function createTodo(id: string, text = '', completed = false): Todo {
  if (!id.trim()) throw new Error('Todo ID must not be empty')
  return Object.freeze({ id, text, completed })
}
