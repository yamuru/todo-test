import { describe, expect, it } from 'vitest'
import { createNote } from '../../app/domain/models/note'
import { createTodo } from '../../app/domain/models/todo'
import {
  canRedo,
  canUndo,
  createHistory,
} from '../../app/domain/history/history'
import {
  addTodo,
  applyEditorOperation,
  changeTitle,
  changeTodoText,
  clearHistory,
  finishSession,
  finishTextEdit,
  redo,
  removeTodo,
  startCreating,
  startEditing,
  toggleTodo,
  undo,
} from '../../app/domain/history/editor-session'

function savedNote() {
  return createNote('note', 'Hello', [
    createTodo('one', 'Buy milk'),
    createTodo('two', 'Read a book', true),
    createTodo('three', 'Take a walk'),
  ])
}

describe('editor session: manual validation scenarios', () => {
  it('Scenario A: continuous title input is one undoable change', () => {
    let session = startEditing(savedNote())
    for (const title of ['Hello W', 'Hello Wo', 'Hello World'])
      session = changeTitle(session, title)
    session = finishTextEdit(session)
    expect(session.history.undoStack).toEqual([
      { kind: 'title', before: 'Hello', after: 'Hello World' },
    ])
    session = undo(session)
    expect(session.note).toEqual(savedNote())
    session = redo(session)
    expect(session.note).toEqual(
      createNote('note', 'Hello World', savedNote().todos),
    )
  })

  it('Scenario B: removing the middle Todo restores its ID, content, completion and position', () => {
    let session = startEditing(savedNote())
    session = removeTodo(session, 'two')
    const removed = createNote('note', 'Hello', [
      createTodo('one', 'Buy milk'),
      createTodo('three', 'Take a walk'),
    ])
    expect(session.note).toEqual(removed)
    session = undo(session)
    expect(session.note).toEqual(savedNote())
    session = redo(session)
    expect(session.note).toEqual(removed)
  })

  it('Scenario C: new action after two undos clears the redo branch', () => {
    let session = startEditing(savedNote())
    for (const id of ['one', 'two', 'three']) session = toggleTodo(session, id)
    session = undo(undo(session))
    expect(session.history.redoStack).toHaveLength(2)
    session = addTodo(session, createTodo('four', 'New branch'))
    expect(canRedo(session.history)).toBe(false)
    expect(redo(session).note).toEqual(session.note)
    expect(session.note.todos).toEqual([
      createTodo('one', 'Buy milk', true),
      createTodo('two', 'Read a book', true),
      createTodo('three', 'Take a walk'),
      createTodo('four', 'New branch'),
    ])
  })

  it('Scenario D: only the last 50 of 55 separate changes can be undone', () => {
    let session = startEditing(savedNote())
    for (let index = 1; index <= 55; index++)
      session = finishTextEdit(changeTitle(session, `Title ${index}`))
    const finalNote = session.note
    expect(session.history.undoStack).toHaveLength(50)
    for (let index = 0; index < 50; index++) session = undo(session)
    expect(session.note.title).toBe('Title 5')
    expect(canUndo(session.history)).toBe(false)
    expect(undo(session).note).toEqual(session.note)
    for (let index = 0; index < 50; index++) session = redo(session)
    expect(session.note).toEqual(finalNote)
    expect(canRedo(session.history)).toBe(false)
  })

  it('Scenario E: ending editing clears both stacks and pending input without changing the saved note', () => {
    const original = {
      id: 'note',
      title: 'Hello',
      todos: [
        { id: 'one', text: 'Buy milk', completed: false },
        { id: 'two', text: 'Read a book', completed: true },
        { id: 'three', text: 'Take a walk', completed: false },
      ],
    }
    let session = startEditing(original)
    session = toggleTodo(session, 'one')
    session = toggleTodo(session, 'two')
    session = undo(session)
    const endedWithRedo = finishSession(session)
    expect(endedWithRedo.history).toEqual(createHistory())
    session = changeTitle(session, 'Changed title')
    const finished = finishSession(session)
    expect(finished.active).toBe(false)
    expect(finished.note).toEqual(
      createNote('note', 'Changed title', [
        createTodo('one', 'Buy milk', true),
        createTodo('two', 'Read a book', true),
        createTodo('three', 'Take a walk'),
      ]),
    )
    expect(finished.history).toEqual(createHistory())
    expect(canUndo(finished.history)).toBe(false)
    expect(canRedo(finished.history)).toBe(false)
    expect(original).toEqual(savedNote())
    expect(Object.isFrozen(original)).toBe(false)
    expect(Object.isFrozen(original.todos[0])).toBe(false)
    original.todos[0]!.text = 'Outside change after editing'
    expect(finished.note.todos[0]?.text).toBe('Buy milk')
  })

  it('Scenario F: title and two Todo text fields undo separately in reverse order', () => {
    let session = startEditing(savedNote())
    session = changeTitle(session, 'New title')
    session = changeTodoText(session, 'one', 'First changed')
    session = changeTodoText(session, 'two', 'Second changed')
    const finalNote = session.note
    session = undo(session)
    expect(session.note).toEqual(
      createNote('note', 'New title', [
        createTodo('one', 'First changed'),
        createTodo('two', 'Read a book', true),
        createTodo('three', 'Take a walk'),
      ]),
    )
    session = undo(session)
    expect(session.note).toEqual(
      createNote('note', 'New title', savedNote().todos),
    )
    session = undo(session)
    expect(session.note).toEqual(savedNote())
    session = redo(redo(redo(session)))
    expect(session.note).toEqual(finalNote)
  })
})

describe('editor session boundaries and invariants', () => {
  it('commits title input when another text field receives an unchanged value', () => {
    const original = createNote('note', 'A', savedNote().todos)
    let session = changeTitle(startEditing(original), 'B')
    session = changeTodoText(session, 'one', 'Buy milk')
    expect(session.history.pendingText).toBeNull()
    expect(session.history.undoStack).toEqual([
      { kind: 'title', before: 'A', after: 'B' },
    ])
    session = changeTitle(session, 'C')
    const finalNote = session.note
    session = undo(session)
    expect(session.note).toEqual(createNote('note', 'B', original.todos))
    session = undo(session)
    expect(session.note).toEqual(original)
    expect(redo(redo(session)).note).toEqual(finalNote)
  })

  it('keeps continuous text input grouped across an unchanged value in the same field', () => {
    let session = changeTitle(startEditing(savedNote()), 'Hello W')
    session = changeTitle(session, 'Hello W')
    expect(session.history.undoStack).toEqual([])
    expect(session.history.pendingText).toEqual({
      kind: 'title',
      before: 'Hello',
      after: 'Hello W',
    })
    session = changeTitle(session, 'Hello World')
    expect(undo(session).note).toEqual(savedNote())
    expect(redo(undo(session)).note).toEqual(session.note)
  })

  it('discards the remaining redo branch after a new change following partial redo', () => {
    let session = startEditing(savedNote())
    for (const title of ['First', 'Second', 'Third']) {
      session = finishTextEdit(changeTitle(session, title))
    }
    session = undo(undo(undo(session)))
    session = redo(redo(session))
    expect(session.note).toEqual(
      createNote('note', 'Second', savedNote().todos),
    )
    expect(session.history.redoStack).toEqual([
      { kind: 'title', before: 'Second', after: 'Third' },
    ])
    session = changeTitle(session, 'New branch')
    expect(session.history.redoStack).toEqual([])
    expect(canRedo(session.history)).toBe(false)
    const finalNote = createNote('note', 'New branch', savedNote().todos)
    session = redo(session)
    expect(session.note).toEqual(finalNote)
    session = undo(session)
    expect(session.note.title).toBe('Second')
    session = undo(session)
    expect(session.note.title).toBe('First')
    session = undo(session)
    expect(session.note).toEqual(savedNote())
    expect(redo(redo(redo(session))).note).toEqual(finalNote)
  })

  it('starts an isolated session for a new empty note', () => {
    const session = startCreating('new-note')
    expect(session).toEqual({
      note: createNote('new-note'),
      history: createHistory(),
      active: true,
    })
    expect(startCreating('another-note').note.id).toBe('another-note')
  })

  it('does not share the working note, list or Todos with the saved object', () => {
    const original = savedNote()
    const session = startEditing(original)
    expect(session.note).not.toBe(original)
    expect(session.note.todos).not.toBe(original.todos)
    expect(session.note.todos[0]).not.toBe(original.todos[0])
    expect(Reflect.set(session.note, 'title', 'Accidental write')).toBe(false)
    expect(
      Reflect.set(session.note.todos[0]!, 'text', 'Accidental write'),
    ).toBe(false)
    expect(Object.isFrozen(session)).toBe(true)
    expect(original).toEqual(savedNote())
  })

  it('handles undo and redo with no operations', () => {
    const session = startEditing(savedNote())
    expect(undo(session)).toEqual(session)
    expect(redo(session)).toEqual(session)
  })

  it('creates separate groups for blur or pause boundaries in the same field', () => {
    let session = startEditing(savedNote())
    session = finishTextEdit(changeTitle(session, 'Hello World'))
    session = finishTextEdit(session)
    session = changeTitle(session, 'Hello World!')
    expect(session.history.undoStack).toHaveLength(1)
    session = undo(session)
    expect(session.note.title).toBe('Hello World')
    session = undo(session)
    expect(session.note.title).toBe('Hello')
  })

  it('groups successive Todo text edits and allows intermediate empty text', () => {
    let session = startEditing(savedNote())
    for (const text of ['', 'New', 'New task'])
      session = changeTodoText(session, 'one', text)
    session = finishTextEdit(session)
    expect(session.history.undoStack).toEqual([
      {
        kind: 'todo-text',
        todoId: 'one',
        before: 'Buy milk',
        after: 'New task',
      },
    ])
    expect(undo(session).note).toEqual(savedNote())
    expect(redo(undo(session)).note).toEqual(session.note)
  })

  it.each(['add', 'remove', 'toggle'] as const)(
    'commits pending text before atomic %s',
    (action) => {
      let session = changeTitle(startEditing(savedNote()), 'Changed')
      switch (action) {
        case 'add':
          session = addTodo(session, createTodo('four'))
          break
        case 'remove':
          session = removeTodo(session, 'two')
          break
        case 'toggle':
          session = toggleTodo(session, 'two')
          break
      }
      expect(session.history.pendingText).toBeNull()
      expect(session.history.undoStack).toHaveLength(2)
      session = undo(session)
      expect(session.note).toEqual(
        createNote('note', 'Changed', savedNote().todos),
      )
      expect(undo(session).note).toEqual(savedNote())
    },
  )

  it('restores edited Todo text before undoing the earlier text change', () => {
    let session = startEditing(savedNote())
    session = changeTodoText(session, 'two', 'Edited book task')
    session = removeTodo(session, 'two')
    const removed = session.note
    session = undo(session)
    expect(session.note.todos[1]).toEqual(
      createTodo('two', 'Edited book task', true),
    )
    session = undo(session)
    expect(session.note).toEqual(savedNote())
    expect(redo(redo(session)).note).toEqual(removed)
  })

  it.each(['one', 'three'])(
    'restores deleted boundary Todo %s to its original position',
    (id) => {
      const original = startEditing(savedNote())
      const removed = removeTodo(original, id)
      expect(undo(removed).note).toEqual(original.note)
      expect(redo(undo(removed)).note).toEqual(removed.note)
    },
  )

  it('adds, edits, toggles and removes the same Todo, then replays the complete history', () => {
    const original = startEditing(savedNote())
    let session = addTodo(original, createTodo('new', 'New task'), 1)
    session = changeTodoText(session, 'new', 'Updated task')
    session = toggleTodo(session, 'new')
    session = removeTodo(session, 'new')
    expect(session.note).toEqual(original.note)
    const expectedStates = [
      createTodo('new', 'Updated task', true),
      createTodo('new', 'Updated task'),
      createTodo('new', 'New task'),
    ]
    for (const expected of expectedStates) {
      session = undo(session)
      expect(session.note.todos[1]).toEqual(expected)
    }
    session = undo(session)
    expect(session.note).toEqual(original.note)
    for (let index = 0; index < 4; index++) session = redo(session)
    expect(session.note).toEqual(original.note)
    expect(
      session.history.undoStack.map((operation) => operation.kind),
    ).toEqual(['todo-add', 'todo-text', 'todo-completed', 'todo-remove'])
  })

  it('starts a fresh group when returning to a previously edited field', () => {
    let session = changeTitle(startEditing(savedNote()), 'First title')
    session = changeTodoText(session, 'one', 'Changed task')
    session = changeTitle(session, 'Second title')
    session = undo(session)
    expect(session.note.title).toBe('First title')
    expect(session.note.todos[0]?.text).toBe('Changed task')
    session = undo(session)
    expect(session.note.todos[0]?.text).toBe('Buy milk')
    expect(undo(session).note).toEqual(savedNote())
  })

  it('keeps earlier history when a pending group returns to its original text', () => {
    let session = toggleTodo(startEditing(savedNote()), 'one')
    session = changeTodoText(session, 'two', 'Temporary')
    session = changeTodoText(session, 'two', 'Read a book')
    session = finishTextEdit(session)
    expect(session.history.pendingText).toBeNull()
    expect(session.history.undoStack).toHaveLength(1)
    expect(undo(session).note).toEqual(savedNote())
  })

  it('clears history without discarding the working note and establishes a new baseline', () => {
    let session = changeTitle(
      toggleTodo(startEditing(savedNote()), 'one'),
      'Changed',
    )
    const baseline = session.note
    session = clearHistory(session)
    expect(session.note).toEqual(baseline)
    expect(session.history).toEqual(createHistory())
    expect(undo(session).note).toEqual(baseline)
    session = changeTitle(session, 'Next')
    expect(undo(session).note).toEqual(baseline)
  })

  it('keeps parallel sessions independent', () => {
    const original = savedNote()
    let first = startEditing(original)
    let second = startEditing(original)
    first = toggleTodo(first, 'one')
    second = changeTitle(second, 'Other session')
    expect(undo(first).note).toEqual(original)
    expect(second.note.title).toBe('Other session')
    expect(undo(second).note).toEqual(original)
    expect(original).toEqual(savedNote())
  })

  it('rejects invalid actions without committing pending text or losing redo', () => {
    let session = toggleTodo(startEditing(savedNote()), 'one')
    session = undo(session)
    expect(() => removeTodo(session, 'missing')).toThrow('not found')
    expect(canRedo(session.history)).toBe(true)
    session = changeTitle(session, 'Pending')
    const before = session
    expect(() => changeTodoText(session, 'missing', 'New')).toThrow('not found')
    expect(() => toggleTodo(session, 'missing')).toThrow('not found')
    expect(() => addTodo(session, createTodo('one'))).toThrow('Duplicate')
    expect(() => addTodo(session, createTodo('new'), -1)).toThrow('position')
    expect(() =>
      applyEditorOperation(session, {
        kind: 'title',
        before: 'Hello',
        after: 'Stale',
      }),
    ).toThrow('current value')
    expect(session).toBe(before)
    expect(session.history.undoStack).toEqual([])
    expect(session.history.pendingText?.after).toBe('Pending')
    expect(undo(session).note).toEqual(savedNote())
  })

  it('creates no history entries for unchanged values and repeated completion', () => {
    let session = startEditing(savedNote())
    session = changeTitle(session, 'Hello')
    session = changeTodoText(session, 'one', 'Buy milk')
    session = finishTextEdit(finishTextEdit(session))
    expect(session.note).toEqual(savedNote())
    expect(session.history).toEqual(createHistory())
  })

  it('closes new and existing sessions and rejects further editing', () => {
    for (const initial of [startCreating('new'), startEditing(savedNote())]) {
      const finished = finishSession(changeTitle(initial, 'Final'))
      expect(finishSession(finished)).toEqual(finished)
      for (const action of [
        () => changeTitle(finished, 'Too late'),
        () => changeTitle(finished, finished.note.title),
        () => addTodo(finished, createTodo('new-todo')),
        () => addTodo(finished, createTodo('new-todo'), -1),
        () =>
          applyEditorOperation(finished, {
            kind: 'todo-text',
            todoId: 'missing',
            before: 'Stale',
            after: 'New',
          }),
        () => finishTextEdit(finished),
        () => clearHistory(finished),
        () => undo(finished),
        () => redo(finished),
      ])
        expect(action).toThrow('session has ended')
      expect(finished.note.title).toBe('Final')
      expect(finished.history).toEqual(createHistory())
    }
  })

  it.each(['one', 'missing'])(
    'checks session activity before processing Todo %s',
    (todoId) => {
      const finished = finishSession(startEditing(savedNote()))
      for (const action of [
        () => changeTodoText(finished, todoId, 'Changed'),
        () => changeTodoText(finished, todoId, 'Buy milk'),
        () => removeTodo(finished, todoId),
        () => toggleTodo(finished, todoId),
      ]) {
        expect(action).toThrowError(new Error('Editing session has ended'))
      }
      expect(finished.note).toEqual(savedNote())
      expect(finished.history).toEqual(createHistory())
    },
  )
})
