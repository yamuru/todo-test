import { describe, expect, it } from 'vitest'
import { createNote } from '../../app/domain/models/note'
import { createTodo } from '../../app/domain/models/todo'
import {
  applyChange,
  canRedo,
  canUndo,
  createHistory,
  finishTextChange,
  HISTORY_LIMIT,
  redoChange,
  undoChange,
} from '../../app/domain/history/history'

function initialState() {
  return {
    note: createNote('note', 'Hello', [createTodo('one', 'First')]),
    history: createHistory(),
  }
}

describe('history', () => {
  it('leaves the note and empty histories intact on undo and redo', () => {
    const state = initialState()
    expect(canUndo(state.history)).toBe(false)
    expect(canRedo(state.history)).toBe(false)
    expect(undoChange(state.note, state.history)).toEqual(state)
    expect(redoChange(state.note, state.history)).toEqual(state)
  })

  it('keeps text pending and commits only once at an explicit boundary', () => {
    const initial = initialState()
    const changed = applyChange(initial.note, initial.history, {
      kind: 'title',
      before: 'Hello',
      after: 'World',
    })
    expect(changed.note.title).toBe('World')
    expect(changed.history.undoStack).toEqual([])
    expect(changed.history.pendingText).toEqual({
      kind: 'title',
      before: 'Hello',
      after: 'World',
    })
    expect(canUndo(changed.history)).toBe(true)
    const committed = finishTextChange(changed.history)
    expect(committed.pendingText).toBeNull()
    expect(committed.undoStack).toEqual([
      { kind: 'title', before: 'Hello', after: 'World' },
    ])
    expect(finishTextChange(committed)).toBe(committed)
    expect(initial).toEqual(initialState())
  })

  it('merges only the active field and drops a group that returns to its original value', () => {
    let state = initialState()
    state = applyChange(state.note, state.history, {
      kind: 'title',
      before: 'Hello',
      after: 'Hello W',
    })
    state = applyChange(state.note, state.history, {
      kind: 'title',
      before: 'Hello W',
      after: 'Hello',
    })
    expect(state).toEqual(initialState())
    expect(finishTextChange(state.history).undoStack).toEqual([])
    expect(canUndo(state.history)).toBe(false)
  })

  it('commits pending text before undo and makes it available for redo', () => {
    let state = initialState()
    state = applyChange(state.note, state.history, {
      kind: 'todo-text',
      todoId: 'one',
      before: 'First',
      after: 'Last',
    })
    state = undoChange(state.note, state.history)
    expect(state.note).toEqual(initialState().note)
    expect(state.history.pendingText).toBeNull()
    expect(state.history.undoStack).toEqual([])
    expect(canRedo(state.history)).toBe(true)
    state = redoChange(state.note, state.history)
    expect(state.note.todos[0]?.text).toBe('Last')
    expect(state.history.undoStack).toHaveLength(1)
  })

  it('commits pending text on redo without replaying a discarded branch', () => {
    let state = initialState()
    state = applyChange(state.note, state.history, {
      kind: 'title',
      before: 'Hello',
      after: 'Old branch',
    })
    state = undoChange(state.note, state.history)
    state = applyChange(state.note, state.history, {
      kind: 'title',
      before: 'Hello',
      after: 'New branch',
    })
    expect(canRedo(state.history)).toBe(false)
    state = redoChange(state.note, state.history)
    expect(state.note.title).toBe('New branch')
    expect(state.history.pendingText).toBeNull()
    expect(state.history.undoStack).toEqual([
      { kind: 'title', before: 'Hello', after: 'New branch' },
    ])
  })

  it('leaves redo intact for actual no-ops and rejects invalid changes without affecting history', () => {
    let state = initialState()
    state = applyChange(state.note, state.history, {
      kind: 'title',
      before: 'Hello',
      after: 'World',
    })
    state = undoChange(state.note, state.history)
    const unchanged = applyChange(state.note, state.history, {
      kind: 'title',
      before: 'Hello',
      after: 'Hello',
    })
    expect(unchanged).toEqual(state)
    expect(canRedo(unchanged.history)).toBe(true)
    expect(() =>
      applyChange(state.note, state.history, {
        kind: 'title',
        before: 'Stale',
        after: 'New',
      }),
    ).toThrow()
    expect(redoChange(state.note, state.history).note.title).toBe('World')
  })

  it('invalidates redo immediately on real input even if the group later returns to its origin', () => {
    let state = initialState()
    state = applyChange(state.note, state.history, {
      kind: 'title',
      before: 'Hello',
      after: 'World',
    })
    state = undoChange(state.note, state.history)
    state = applyChange(state.note, state.history, {
      kind: 'title',
      before: 'Hello',
      after: 'H',
    })
    expect(state.history.redoStack).toEqual([])
    state = applyChange(state.note, state.history, {
      kind: 'title',
      before: 'H',
      after: 'Hello',
    })
    expect(state.note.title).toBe('Hello')
    expect(state.history.pendingText).toBeNull()
    expect(state.history.undoStack).toEqual([])
    expect(state.history.redoStack).toEqual([])
  })

  it('keeps each checkbox toggle atomic and stores only reversible payloads', () => {
    let state = initialState()
    for (let index = 0; index < 3; index++) {
      const before = state.note.todos[0]!.completed
      state = applyChange(state.note, state.history, {
        kind: 'todo-completed',
        todoId: 'one',
        before,
        after: !before,
      })
    }
    expect(state.history.undoStack).toEqual([
      { kind: 'todo-completed', todoId: 'one', before: false, after: true },
      { kind: 'todo-completed', todoId: 'one', before: true, after: false },
      { kind: 'todo-completed', todoId: 'one', before: false, after: true },
    ])
    for (const completed of [false, true, false]) {
      state = undoChange(state.note, state.history)
      expect(state.note.todos[0]?.completed).toBe(completed)
    }
    for (const completed of [true, false, true]) {
      state = redoChange(state.note, state.history)
      expect(state.note.todos[0]?.completed).toBe(completed)
    }
  })

  it('caps committed operations while keeping pending text undoable', () => {
    let state = initialState()
    for (let index = 1; index <= HISTORY_LIMIT + 5; index++) {
      state = applyChange(state.note, state.history, {
        kind: 'title',
        before: state.note.title,
        after: String(index),
      })
      state = { ...state, history: finishTextChange(state.history) }
    }
    expect(state.history.undoStack).toHaveLength(HISTORY_LIMIT)
    expect(state.history.undoStack[0]).toEqual({
      kind: 'title',
      before: '5',
      after: '6',
    })
    state = applyChange(state.note, state.history, {
      kind: 'title',
      before: '55',
      after: 'Pending',
    })
    expect(state.history.undoStack).toHaveLength(HISTORY_LIMIT)
    expect(state.history.pendingText?.after).toBe('Pending')
    state = undoChange(state.note, state.history)
    expect(state.note.title).toBe('55')
    for (let index = 0; index < HISTORY_LIMIT; index++)
      state = undoChange(state.note, state.history)
    expect(state.note.title).toBe('6')
    expect(state.history.redoStack).toHaveLength(HISTORY_LIMIT)
    for (let index = 0; index < HISTORY_LIMIT; index++)
      state = redoChange(state.note, state.history)
    expect(state.note.title).toBe('Pending')
    expect(state.history.undoStack).toHaveLength(HISTORY_LIMIT)
  })

  it('copies mutable command inputs and freezes all published history data', () => {
    const original = initialState()
    const todo = { id: 'new', text: 'Original', completed: true }
    const command = { kind: 'todo-add' as const, todo, index: 1 }
    const state = applyChange(original.note, original.history, command)
    todo.text = 'External mutation'
    command.index = 0
    expect(state.history.undoStack).toEqual([
      { kind: 'todo-add', todo: createTodo('new', 'Original', true), index: 1 },
    ])
    expect(Object.isFrozen(state.history)).toBe(true)
    expect(Object.isFrozen(state.history.undoStack)).toBe(true)
    expect(Object.isFrozen(state.history.redoStack)).toBe(true)
    expect(Reflect.set(state.history.undoStack[0]!, 'index', 0)).toBe(false)
    expect(undoChange(state.note, state.history).note).toEqual(original.note)
  })
})
