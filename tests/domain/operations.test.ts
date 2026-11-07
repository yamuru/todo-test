import { describe, expect, it } from 'vitest'
import { createNote, getTodo } from '../../app/domain/models/note'
import { createTodo } from '../../app/domain/models/todo'
import {
  applyOperation,
  copyOperation,
  type Operation,
} from '../../app/domain/history/operations'

function sampleNote() {
  return createNote('note-1', 'Weekend', [
    createTodo('milk', 'Buy milk'),
    createTodo('book', 'Read a book', true),
    createTodo('walk', 'Take a walk'),
  ])
}

describe('domain models', () => {
  it('creates minimal entities with explicit stable IDs and editable empty text', () => {
    expect(createTodo('todo-1')).toEqual({
      id: 'todo-1',
      text: '',
      completed: false,
    })
    expect(createNote('note-1')).toEqual({ id: 'note-1', title: '', todos: [] })
    expect(createTodo('done', 'Finished', true)).toEqual({
      id: 'done',
      text: 'Finished',
      completed: true,
    })
  })

  it('copies nested caller data and prevents mutation of model results', () => {
    const todo = { id: 'todo-1', text: 'Original', completed: false }
    const todos = [todo]
    const note = createNote('note-1', 'Original', todos)
    todo.text = 'Changed outside'
    todos.length = 0
    expect(note.todos).toEqual([
      { id: 'todo-1', text: 'Original', completed: false },
    ])
    expect(Object.isFrozen(note)).toBe(true)
    expect(Object.isFrozen(note.todos)).toBe(true)
    expect(Object.isFrozen(note.todos[0])).toBe(true)
    expect(Reflect.set(note.todos[0]!, 'completed', true)).toBe(false)
  })

  it.each(['', '  '])('rejects an empty ID %j', (id) => {
    expect(() => createTodo(id)).toThrow('ID must not be empty')
    expect(() => createNote(id)).toThrow('ID must not be empty')
  })

  it('rejects duplicate Todo IDs and invalid nested IDs', () => {
    expect(() =>
      createNote('note', '', [createTodo('same'), createTodo('same')]),
    ).toThrow('unique')
    expect(() =>
      createNote('note', '', [{ id: '', text: '', completed: false }]),
    ).toThrow('ID')
  })

  it('finds Todos by stable ID and reports missing IDs', () => {
    expect(getTodo(sampleNote(), 'book')).toEqual(
      createTodo('book', 'Read a book', true),
    )
    expect(() => getTodo(sampleNote(), 'absent')).toThrow(
      'Todo not found: absent',
    )
  })
})

describe('reversible operations', () => {
  const cases: {
    name: string
    operation: Operation
    expected: ReturnType<typeof createNote>
  }[] = [
    {
      name: 'title',
      operation: { kind: 'title', before: 'Weekend', after: 'Holiday' },
      expected: createNote('note-1', 'Holiday', sampleNote().todos),
    },
    {
      name: 'Todo text',
      operation: {
        kind: 'todo-text',
        todoId: 'milk',
        before: 'Buy milk',
        after: '',
      },
      expected: createNote('note-1', 'Weekend', [
        createTodo('milk'),
        ...sampleNote().todos.slice(1),
      ]),
    },
    {
      name: 'completed',
      operation: {
        kind: 'todo-completed',
        todoId: 'book',
        before: true,
        after: false,
      },
      expected: createNote('note-1', 'Weekend', [
        createTodo('milk', 'Buy milk'),
        createTodo('book', 'Read a book'),
        createTodo('walk', 'Take a walk'),
      ]),
    },
    {
      name: 'add at the middle',
      operation: {
        kind: 'todo-add',
        todo: createTodo('tea', 'Make tea', true),
        index: 1,
      },
      expected: createNote('note-1', 'Weekend', [
        createTodo('milk', 'Buy milk'),
        createTodo('tea', 'Make tea', true),
        createTodo('book', 'Read a book', true),
        createTodo('walk', 'Take a walk'),
      ]),
    },
    ...[0, 1, 2].map((index) => ({
      name: `remove at position ${index}`,
      operation: {
        kind: 'todo-remove',
        todo: sampleNote().todos[index]!,
        index,
      } satisfies Operation,
      expected: createNote(
        'note-1',
        'Weekend',
        sampleNote().todos.filter((_, position) => position !== index),
      ),
    })),
  ]

  it.each(cases)(
    'applies and reverses $name, preserving all IDs and positions',
    ({ operation, expected }) => {
      const original = sampleNote()
      const changed = applyOperation(original, operation)
      expect(changed).toEqual(expected)
      expect(original).toEqual(sampleNote())
      const restored = applyOperation(changed, operation, 'inverse')
      expect(restored).toEqual(original)
      expect(applyOperation(restored, operation)).toEqual(expected)
    },
  )

  it.each([0, 3])('inserts at boundary position %i', (index) => {
    const original = sampleNote()
    const operation: Operation = {
      kind: 'todo-add',
      todo: createTodo('tea'),
      index,
    }
    const next = applyOperation(original, operation)
    expect(next.todos[index]?.id).toBe('tea')
    expect(applyOperation(next, operation, 'inverse')).toEqual(original)
  })

  it('supports insertion into and removal from a single-item note', () => {
    const empty = createNote('note')
    const operation: Operation = {
      kind: 'todo-add',
      todo: createTodo('first'),
      index: 0,
    }
    const next = applyOperation(empty, operation)
    expect(next.todos).toEqual([createTodo('first')])
    expect(applyOperation(next, operation, 'inverse')).toEqual(empty)
  })

  it.each<Operation>([
    { kind: 'title', before: 'Weekend', after: 'Weekend' },
    {
      kind: 'todo-text',
      todoId: 'milk',
      before: 'Buy milk',
      after: 'Buy milk',
    },
    { kind: 'todo-completed', todoId: 'milk', before: false, after: false },
  ])('keeps actual no-op $kind unchanged in both directions', (operation) => {
    const note = sampleNote()
    expect(applyOperation(note, operation)).toBe(note)
    expect(applyOperation(note, operation, 'inverse')).toBe(note)
  })

  it.each<Operation>([
    { kind: 'title', before: 'Old stale title', after: 'New title' },
    {
      kind: 'todo-text',
      todoId: 'milk',
      before: 'Stale text',
      after: 'New text',
    },
    { kind: 'todo-completed', todoId: 'milk', before: true, after: false },
    {
      kind: 'todo-remove',
      todo: createTodo('book', 'Stale text', true),
      index: 1,
    },
    { kind: 'todo-remove', todo: createTodo('book', 'Read a book'), index: 1 },
    {
      kind: 'todo-remove',
      todo: createTodo('book', 'Read a book', true),
      index: 0,
    },
    { kind: 'todo-add', todo: createTodo('book'), index: 1 },
  ])(
    'rejects stale, conflicting or misplaced $kind without changing input',
    (operation) => {
      const note = sampleNote()
      expect(() => applyOperation(note, operation)).toThrow()
      expect(note).toEqual(sampleNote())
    },
  )

  it.each<Operation>([
    { kind: 'todo-text', todoId: 'missing', before: '', after: '' },
    { kind: 'todo-completed', todoId: 'missing', before: false, after: true },
    { kind: 'todo-remove', todo: createTodo('missing'), index: 1 },
  ])(
    'rejects operations on missing Todos, including apparent no-ops ($kind)',
    (operation) => {
      expect(() => applyOperation(sampleNote(), operation)).toThrow(
        'Todo not found',
      )
      if (operation.kind !== 'todo-remove') {
        expect(() =>
          applyOperation(sampleNote(), operation, 'inverse'),
        ).toThrow()
      }
    },
  )

  it.each([-1, 4, 0.5, NaN, Infinity])(
    'rejects invalid position %s',
    (index) => {
      for (const kind of ['todo-add', 'todo-remove'] as const) {
        expect(() =>
          applyOperation(sampleNote(), {
            kind,
            todo: createTodo('new'),
            index,
          }),
        ).toThrow('position')
      }
    },
  )

  it.each(cases)(
    'rejects a second forward application of $name',
    ({ operation }) => {
      const changed = applyOperation(sampleNote(), operation)
      expect(() => applyOperation(changed, operation)).toThrow()
    },
  )

  it.each(cases)(
    'rejects a second inverse application of $name',
    ({ operation }) => {
      const original = sampleNote()
      const changed = applyOperation(original, operation)
      const restored = applyOperation(changed, operation, 'inverse')
      expect(restored).toEqual(original)
      expect(() => applyOperation(restored, operation, 'inverse')).toThrow()
    },
  )

  it('detaches inserted data and history payloads from mutable caller references', () => {
    const todo = { id: 'tea', text: 'Make tea', completed: false }
    const operation = { kind: 'todo-add', todo, index: 0 } as const
    const note = applyOperation(sampleNote(), operation)
    const copied = copyOperation(operation)
    todo.text = 'Mutated outside'
    expect(note.todos[0]).toEqual(createTodo('tea', 'Make tea'))
    expect(copied).toEqual({
      kind: 'todo-add',
      todo: createTodo('tea', 'Make tea'),
      index: 0,
    })
    expect(Object.isFrozen(copied)).toBe(true)
    if (copied.kind === 'todo-add')
      expect(Object.isFrozen(copied.todo)).toBe(true)
  })
})
