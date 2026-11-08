import { createPinia, disposePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createNote } from '../../app/domain/models/note'
import { createTodo } from '../../app/domain/models/todo'
import { createHistory } from '../../app/domain/history/history'
import { DRAFT_DEBOUNCE_MS } from '../../app/persistence/debounce'
import {
  createPersistence,
  draftKey,
  NOTES_KEY,
} from '../../app/persistence/storage'
import { defineNotesStore } from '../../app/stores/notes'
import { defineEditorStore } from '../../app/stores/editor'
import { MemoryStorage, namedError } from '../helpers/storage'

const original = createNote('note', 'Original', [
  createTodo('one', 'First'),
  createTodo('two', 'Second', true),
])
const piniaInstances: ReturnType<typeof createPinia>[] = []
let revision = 0
let sessionIdentity = 0

function tab(storage = new MemoryStorage()) {
  const pinia = createPinia()
  piniaInstances.push(pinia)
  const persistence = createPersistence(
    () => storage,
    () => `revision-${++revision}`,
  )
  const useNotes = defineNotesStore(persistence)
  const notes = useNotes(pinia)
  let nextId = 0
  const newId = vi.fn(() => `generated-${++nextId}`)
  const editor = defineEditorStore({
    persistence,
    notesStore: () => notes,
    newId,
    newSessionId: () => `session-${++sessionIdentity}`,
    now: () => 1234,
  })(pinia)
  return { pinia, storage, persistence, notes, editor, newId }
}

function savedTab() {
  const context = tab()
  expect(context.notes.saveNote(original, null).ok).toBe(true)
  return context
}

beforeEach(() => {
  vi.useFakeTimers()
  revision = 0
  sessionIdentity = 0
})
afterEach(() => {
  for (const pinia of piniaInstances.splice(0)) disposePinia(pinia)
  vi.useRealTimers()
})

describe('saved notes and domain integration', () => {
  it('loads an empty collection and distinguishes a read failure', () => {
    const { notes, storage } = tab()
    expect(notes.loaded).toBe(false)
    expect(notes.load()).toEqual({ ok: true, value: [] })
    expect(notes.loaded).toBe(true)
    storage.data.set(NOTES_KEY, '{')
    expect(notes.load()).toMatchObject({
      ok: false,
      error: { code: 'invalid-json' },
    })
    expect(notes.error?.code).toBe('invalid-json')
    expect(storage.data.get(NOTES_KEY)).toBe('{')
  })

  it('Scenario A: persists a new note, Todo IDs and order across fresh store instances', () => {
    const { editor, notes, storage, newId } = tab()
    expect(editor.createNew()).toEqual({ ok: true, value: 'generated-1' })
    editor.changeTitle('New note')
    expect(editor.addTodo('First')).toEqual({ ok: true, value: 'generated-2' })
    expect(editor.addTodo('Second', 0)).toEqual({
      ok: true,
      value: 'generated-3',
    })
    editor.toggleTodo('generated-3')
    expect(notes.notes).toEqual([])
    expect(editor.save()).toMatchObject({
      ok: true,
      value: { cleanupError: null },
    })
    const next = tab(storage)
    expect(next.notes.load().ok).toBe(true)
    expect(next.notes.getNote('generated-1')).toEqual(
      createNote('generated-1', 'New note', [
        createTodo('generated-3', 'Second', true),
        createTodo('generated-2', 'First'),
      ]),
    )
    expect(newId).toHaveBeenCalledTimes(3)
  })

  it('Scenario B: editing does not mutate saved data until Save', () => {
    const { editor, notes, storage } = savedTab()
    const savedRaw = storage.getItem(NOTES_KEY)
    editor.openNote('note')
    const firstSession = editor.session
    editor.changeTitle('Changed')
    editor.changeTodoText('one', 'Changed task')
    editor.toggleTodo('two')
    expect(editor.session).not.toBe(firstSession)
    expect(firstSession?.note).toEqual(original)
    expect(Object.isFrozen(editor.session)).toBe(true)
    expect(Object.isFrozen(editor.session?.note.todos[0])).toBe(true)
    expect(Reflect.set(editor.session!.note, 'title', 'Mutation')).toBe(false)
    expect(notes.getNote('note')).toEqual(original)
    expect(storage.getItem(NOTES_KEY)).toBe(savedRaw)
    expect(editor.dirty).toBe(true)
    expect(editor.save().ok).toBe(true)
    expect(notes.getNote('note')).toEqual(editor.session?.note)
    expect(notes.getNote('note')?.title).toBe('Changed')
    expect(editor.session?.history).toEqual(createHistory())
    expect(editor.active).toBe(false)
  })

  it('groups text, commits at field boundaries, and preserves IDs through undo/redo', () => {
    const { editor, notes, newId } = savedTab()
    editor.openNote('note')
    editor.changeTitle('O')
    editor.changeTitle('Other')
    expect(editor.session?.history.undoStack).toEqual([])
    expect(editor.session?.history.pendingText).toMatchObject({
      before: 'Original',
      after: 'Other',
    })
    editor.changeTodoText('one', 'Edited')
    editor.removeTodo('two')
    const edited = editor.session?.note
    expect(editor.session?.history.undoStack).toHaveLength(3)
    editor.undo()
    expect(editor.session?.note.todos[1]).toEqual(original.todos[1])
    editor.undo()
    editor.undo()
    expect(editor.session?.note).toEqual(original)
    expect(editor.dirty).toBe(false)
    expect(editor.undoAvailable).toBe(false)
    expect(editor.redoAvailable).toBe(true)
    editor.redo()
    editor.redo()
    editor.redo()
    expect(editor.session?.note).toEqual(edited)
    editor.undo()
    editor.addTodo('New branch')
    expect(editor.redoAvailable).toBe(false)
    expect(newId).toHaveBeenCalledTimes(1)
    expect(notes.getNote('note')).toEqual(original)
  })

  it('ends text groups at an explicit boundary and at an idle pause', () => {
    const { editor } = savedTab()
    editor.openNote('note')
    editor.changeTitle('First')
    editor.finishTextEdit()
    editor.changeTitle('Second')
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS)
    expect(editor.session?.history.pendingText).toBeNull()
    editor.changeTitle('Third')
    editor.undo()
    expect(editor.session?.note.title).toBe('Second')
    editor.undo()
    expect(editor.session?.note.title).toBe('First')
  })

  it('returns validation errors without trimming input away; Save commits pending text', () => {
    const { editor, notes } = savedTab()
    editor.openNote('note')
    editor.changeTitle('  ')
    expect(editor.save()).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    })
    expect(editor.session?.history.pendingText).toBeNull()
    expect(editor.session?.history.undoStack).toHaveLength(1)
    expect(editor.session?.note.title).toBe('  ')
    expect(editor.active).toBe(true)
    expect(notes.getNote('note')).toEqual(original)
    editor.changeTitle('Valid')
    editor.changeTodoText('one', '\t')
    expect(editor.save()).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    })
    expect(editor.session?.note.todos[0]?.text).toBe('\t')
    editor.changeTodoText('one', 'Valid task')
    expect(editor.save().ok).toBe(true)
  })

  it('Scenario F: failed Save keeps the working copy, history and retry path', () => {
    const { editor, storage, notes } = savedTab()
    editor.openNote('note')
    editor.toggleTodo('two')
    editor.changeTitle('Local')
    const working = editor.session?.note
    storage.writeError = namedError('QuotaExceededError')
    expect(editor.save()).toMatchObject({ ok: false, error: { code: 'quota' } })
    expect(editor.active).toBe(true)
    expect(editor.session?.note).toBe(working)
    expect(editor.session?.history.undoStack).toHaveLength(2)
    expect(editor.undoAvailable).toBe(true)
    expect(notes.getNote('note')).toEqual(original)
    storage.writeError = null
    expect(editor.save().ok).toBe(true)
  })

  it('returns missing-note and inactive results without opening a session', () => {
    const { editor } = tab()
    expect(editor.openNote('missing')).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
    expect(editor.save()).toMatchObject({
      ok: false,
      error: { code: 'inactive' },
    })
    expect(editor.changeTitle('x')).toMatchObject({
      ok: false,
      error: { code: 'inactive' },
    })
    expect(editor.addTodo()).toMatchObject({
      ok: false,
      error: { code: 'inactive' },
    })
    expect(editor.undo()).toMatchObject({
      ok: false,
      error: { code: 'inactive' },
    })
    expect(editor.flushDraft().ok).toBe(true)
    expect(editor.cancel().ok).toBe(true)
    expect(editor.session).toBeNull()
  })

  it('rejects invalid domain actions and replacing an active session without losing data', () => {
    const { editor } = savedTab()
    editor.openNote('note')
    editor.changeTitle('Local')
    const session = editor.session
    expect(editor.removeTodo('missing')).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    })
    expect(editor.openNote('note')).toMatchObject({
      ok: false,
      error: { code: 'busy' },
    })
    expect(editor.createNew()).toMatchObject({
      ok: false,
      error: { code: 'busy' },
    })
    expect(editor.session).toBe(session)
  })

  it('deletes saved notes, persists deletion and rejects repeated deletion', () => {
    const { notes, storage } = savedTab()
    expect(notes.deleteNote('note').ok).toBe(true)
    expect(notes.notes).toEqual([])
    const fresh = tab(storage)
    expect(fresh.notes.load()).toEqual({ ok: true, value: [] })
    expect(notes.deleteNote('note')).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
  })

  it('retains the last readable collection on read or delete write errors', () => {
    const { notes, storage } = savedTab()
    storage.writeError = namedError('QuotaExceededError')
    expect(notes.deleteNote('note').ok).toBe(false)
    expect(notes.getNote('note')).toEqual(original)
    storage.readError = namedError('SecurityError')
    expect(notes.load().ok).toBe(false)
    expect(notes.getNote('note')).toEqual(original)
  })
})

describe('draft lifecycle', () => {
  it('debounces rapid edits into one draft write with the latest state', () => {
    const { editor, storage, persistence } = savedTab()
    editor.openNote('note')
    const writesBefore = storage.writes.length
    editor.changeTitle('A')
    vi.advanceTimersByTime(200)
    editor.changeTitle('AB')
    editor.changeTodoText('one', 'Latest')
    expect(editor.draftState.status).toBe('pending')
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1)
    expect(storage.writes).toHaveLength(writesBefore)
    vi.advanceTimersByTime(1)
    expect(storage.writes.slice(writesBefore)).toEqual([
      draftKey('note', editor.draftIdentity!.sessionId),
    ])
    expect(persistence.findDrafts('note')).toMatchObject({
      ok: true,
      value: [{ draft: { note: editor.session?.note, updatedAt: 1234 } }],
    })
    expect(editor.draftState.status).toBe('written')
  })

  it('Scenario C: flushes, discovers and explicitly restores a draft with empty history and dirty baseline', () => {
    const first = savedTab()
    first.editor.openNote('note')
    first.editor.changeTitle('Recovered title')
    first.editor.changeTodoText('one', 'Recovered task')
    first.editor.flushDraft()
    const next = tab(first.storage)
    expect(next.editor.discoverDrafts()).toMatchObject({
      ok: true,
      value: [{ draft: { note: first.editor.session?.note } }],
    })
    expect(next.editor.openNote('note').ok).toBe(true)
    expect(next.editor.session).toBeNull()
    expect(next.editor.recovery?.note.title).toBe('Recovered title')
    expect(next.editor.createNew()).toMatchObject({
      ok: false,
      error: { code: 'recovery-pending' },
    })
    expect(next.editor.restoreDraft().ok).toBe(true)
    expect(next.editor.session?.note).toEqual(first.editor.session?.note)
    expect(next.editor.session?.history).toEqual(createHistory())
    expect(next.editor.dirty).toBe(true)
    expect(next.editor.undoAvailable).toBe(false)
    expect(next.newId).not.toHaveBeenCalled()
    next.editor.changeTitle('Next change')
    next.editor.undo()
    expect(next.editor.session?.note.title).toBe('Recovered title')
    expect(next.editor.save().ok).toBe(true)
  })

  it('discovers and restores unsaved new notes without allocating new IDs', () => {
    const first = tab()
    first.editor.createNew()
    first.editor.changeTitle('Unsaved new')
    first.editor.addTodo('Task')
    first.editor.flushDraft()
    const next = tab(first.storage)
    expect(next.editor.offerRecovery('generated-1').ok).toBe(true)
    expect(next.editor.active).toBe(false)
    next.editor.restoreDraft()
    expect(next.editor.session?.note).toEqual(first.editor.session?.note)
    expect(next.editor.dirty).toBe(true)
    expect(next.newId).not.toHaveBeenCalled()
    expect(next.editor.save().ok).toBe(true)
  })

  it('declining recovery deletes only the draft and opens the saved baseline', () => {
    const first = savedTab()
    first.editor.openNote('note')
    first.editor.changeTitle('Draft')
    first.editor.flushDraft()
    const next = tab(first.storage)
    next.editor.openNote('note')
    expect(next.editor.discardRecovery().ok).toBe(true)
    expect(next.editor.recovery).toBeNull()
    expect(next.editor.session?.note).toEqual(original)
    expect(next.editor.dirty).toBe(false)
    expect(next.persistence.findDrafts('note')).toEqual({
      ok: true,
      value: [],
    })
  })

  it.each(['save', 'cancel'] as const)(
    'Scenario D: %s clears history/draft and prevents delayed resurrection',
    (action) => {
      const { editor, storage, persistence, notes } = savedTab()
      editor.openNote('note')
      editor.changeTitle('Written draft')
      editor.flushDraft()
      editor.changeTitle('Pending newer change')
      expect(editor[action]().ok).toBe(true)
      expect(editor.active).toBe(false)
      expect(editor.session?.history).toEqual(createHistory())
      vi.runAllTimers()
      expect(persistence.findDrafts('note')).toEqual({ ok: true, value: [] })
      const fresh = tab(storage)
      expect(fresh.editor.openNote('note').ok).toBe(true)
      expect(fresh.editor.recovery).toBeNull()
      expect(notes.getNote('note')?.title).toBe(
        action === 'save' ? 'Pending newer change' : 'Original',
      )
      expect(editor.cancel().ok).toBe(true)
    },
  )

  it('flush cancels the delayed write and captures latest input once', () => {
    const { editor, storage, persistence } = savedTab()
    editor.openNote('note')
    editor.changeTitle('Latest')
    expect(editor.flushDraft().ok).toBe(true)
    const writes = [...storage.writes]
    expect(persistence.findDrafts('note')).toMatchObject({
      ok: true,
      value: [{ draft: { note: { title: 'Latest' } } }],
    })
    vi.runAllTimers()
    expect(storage.writes).toEqual(writes)
  })

  it('removes an obsolete draft when undo returns to the saved baseline', () => {
    const { editor, persistence } = savedTab()
    editor.openNote('note')
    editor.changeTitle('Temporary')
    editor.flushDraft()
    editor.undo()
    vi.runAllTimers()
    expect(editor.dirty).toBe(false)
    expect(persistence.findDrafts('note')).toEqual({ ok: true, value: [] })
    expect(editor.redoAvailable).toBe(true)
  })

  it('draft write errors preserve working data/history and support flush retry', () => {
    const { editor, storage, persistence } = savedTab()
    editor.openNote('note')
    editor.changeTitle('Keep me')
    storage.writeError = namedError('QuotaExceededError')
    vi.runAllTimers()
    expect(editor.draftState).toMatchObject({
      status: 'error',
      error: { code: 'quota' },
    })
    expect(editor.session?.note.title).toBe('Keep me')
    expect(editor.undoAvailable).toBe(true)
    storage.writeError = null
    expect(editor.flushDraft().ok).toBe(true)
    expect(persistence.findDrafts('note')).toMatchObject({
      ok: true,
      value: [{ draft: { note: { title: 'Keep me' } } }],
    })
  })

  it('failed Cancel/discard does not pretend the draft was removed', () => {
    const { editor, storage } = savedTab()
    editor.openNote('note')
    editor.changeTitle('Draft')
    editor.flushDraft()
    storage.removeError = namedError('SecurityError')
    expect(editor.cancel()).toMatchObject({
      ok: false,
      error: { code: 'security' },
    })
    expect(editor.active).toBe(true)
    expect(editor.undoAvailable).toBe(true)
    const fresh = tab(storage)
    fresh.editor.openNote('note')
    expect(fresh.editor.discardRecovery().ok).toBe(false)
    expect(fresh.editor.recovery?.note.title).toBe('Draft')
    storage.removeError = null
    expect(editor.cancel().ok).toBe(true)
  })

  it('reports committed Save separately from draft cleanup failure and allows cleanup retry', () => {
    const { editor, storage, notes, persistence } = savedTab()
    editor.openNote('note')
    editor.changeTitle('Saved title')
    editor.flushDraft()
    storage.removeError = namedError('SecurityError')
    expect(editor.save()).toMatchObject({
      ok: true,
      value: {
        note: { title: 'Saved title' },
        cleanupError: { code: 'security' },
      },
    })
    expect(editor.cleanupError?.code).toBe('security')
    expect(notes.getNote('note')?.title).toBe('Saved title')
    vi.runAllTimers()
    storage.removeError = null
    expect(editor.retryDraftCleanup().ok).toBe(true)
    expect(persistence.findDrafts('note')).toEqual({ ok: true, value: [] })
  })

  it('disposal cancels outstanding timers', () => {
    const { editor, pinia, storage } = savedTab()
    editor.openNote('note')
    editor.changeTitle('Pending')
    disposePinia(pinia)
    vi.runAllTimers()
    expect(
      storage.data.has(draftKey('note', editor.draftIdentity!.sessionId)),
    ).toBe(false)
  })
})

describe('sequential multi-tab conflicts', () => {
  it.each([false, true])(
    'rejects an old deletion confirmation after a remote Save (storage event: %s)',
    (receiveStorageEvent) => {
      const a = savedTab()
      const confirmedRevision = a.notes.getEntry('note')!.revision
      const b = tab(a.storage)
      b.editor.openNote('note')
      b.editor.changeTitle('Remote work saved after the confirmation opened')
      expect(b.editor.save().ok).toBe(true)
      if (receiveStorageEvent) a.notes.load()

      expect(a.notes.deleteNote('note', confirmedRevision)).toMatchObject({
        ok: false,
        error: { code: 'conflict' },
      })
      a.notes.load()
      expect(a.notes.getNote('note')?.title).toBe(
        'Remote work saved after the confirmation opened',
      )
      expect(
        a.notes.deleteNote('note', a.notes.getEntry('note')!.revision).ok,
      ).toBe(true)
    },
  )

  it('Scenario E: observes deletion, preserves local text and cannot resurrect the old ID', () => {
    const a = savedTab()
    const b = tab(a.storage)
    a.editor.openNote('note')
    a.editor.changeTitle('Local work')
    b.notes.load()
    b.notes.deleteNote('note')
    a.notes.load()
    expect(a.editor.conflict).toBe('deleted')
    expect(a.editor.session?.note.title).toBe('Local work')
    expect(a.editor.save()).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
    expect(a.persistence.loadNotes()).toEqual({ ok: true, value: [] })
    expect(a.editor.reloadLatest()).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
    expect(a.editor.cancel().ok).toBe(true)
  })

  it.each(['changed', 'deleted'] as const)(
    'Save detects %s even without a storage event',
    (kind) => {
      const a = savedTab()
      const b = tab(a.storage)
      a.editor.openNote('note')
      a.editor.changeTitle('Local')
      b.notes.load()
      if (kind === 'changed') {
        b.editor.openNote('note')
        b.editor.changeTitle('Remote')
        b.editor.save()
      } else b.notes.deleteNote('note')
      expect(a.editor.conflict).toBeNull()
      expect(a.editor.save()).toMatchObject({
        ok: false,
        error: { code: kind === 'changed' ? 'conflict' : 'not-found' },
      })
      expect(a.editor.conflict).toBe(kind)
      expect(a.editor.session?.note.title).toBe('Local')
      expect(a.editor.undoAvailable).toBe(true)
    },
  )

  it('loads the latest version only after explicit conflict resolution', () => {
    const a = savedTab()
    const b = tab(a.storage)
    a.editor.openNote('note')
    b.editor.openNote('note')
    a.editor.changeTitle('Local')
    a.editor.flushDraft()
    b.editor.changeTitle('Remote')
    b.editor.save()
    a.notes.load()
    expect(a.editor.conflict).toBe('changed')
    expect(a.editor.session?.note.title).toBe('Local')
    expect(a.editor.reloadLatest().ok).toBe(true)
    expect(a.editor.session?.note.title).toBe('Remote')
    expect(a.editor.conflict).toBeNull()
    expect(a.editor.dirty).toBe(false)
    expect(a.editor.session?.history).toEqual(createHistory())
    vi.runAllTimers()
    expect(a.persistence.findDrafts('note')).toEqual({ ok: true, value: [] })
  })

  it('keeps a restored obsolete draft blocked after remote deletion', () => {
    const a = savedTab()
    a.editor.openNote('note')
    a.editor.changeTitle('Old draft')
    a.editor.flushDraft()
    const b = tab(a.storage)
    b.notes.load()
    b.notes.deleteNote('note')
    const fresh = tab(a.storage)
    fresh.editor.openNote('note')
    expect(fresh.editor.session).toBeNull()
    fresh.editor.restoreDraft()
    expect(fresh.editor.conflict).toBe('deleted')
    expect(fresh.editor.dirty).toBe(true)
    expect(fresh.editor.save()).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
    fresh.editor.cancel()
  })

  it('preserves another tab’s unrelated additions/edits when saving from an old list', () => {
    const a = savedTab()
    const b = tab(a.storage)
    b.notes.saveNote(createNote('other', 'Before remote edit'), null)
    a.editor.openNote('note')
    a.editor.changeTitle('Updated original')
    b.notes.saveNote(
      createNote('other', 'Remote edit'),
      b.notes.getEntry('other')!.revision,
    )
    b.notes.saveNote(createNote('added', 'Remote addition'), null)
    expect(a.notes.notes).toHaveLength(2)
    expect(a.editor.save().ok).toBe(true)
    expect(a.notes.notes.map((note) => note.title)).toEqual([
      'Updated original',
      'Remote edit',
      'Remote addition',
    ])
  })
})

describe('draft ownership regressions', () => {
  it.each(['save', 'cancel'] as const)(
    'clean B flush/%s preserves A’s draft, including when B opens after the draft was written',
    (action) => {
      const a = savedTab()
      a.editor.openNote('note')
      a.editor.changeTitle('A work')
      a.editor.flushDraft()
      const aKey = draftKey('note', a.editor.draftIdentity!.sessionId)
      const aRaw = a.storage.getItem(aKey)
      const b = tab(a.storage)
      expect(b.editor.openNote('note').ok).toBe(true)
      expect(b.editor.recovery?.note.title).toBe('A work')
      expect(b.editor.editSavedVersion('note').ok).toBe(true)
      expect(b.editor.flushDraft().ok).toBe(true)
      expect(a.storage.getItem(aKey)).toBe(aRaw)
      expect(b.editor[action]().ok).toBe(true)
      vi.runAllTimers()
      expect(a.storage.getItem(aKey)).toBe(aRaw)
    },
  )

  it.each(['save', 'cancel'] as const)(
    'two dirty sessions persist independently; %s only clears its own key',
    (action) => {
      const a = savedTab()
      const b = tab(a.storage)
      a.editor.openNote('note')
      b.editor.openNote('note')
      a.editor.changeTitle('A draft')
      b.editor.changeTitle('B draft')
      expect(a.editor.flushDraft().ok).toBe(true)
      expect(b.editor.flushDraft().ok).toBe(true)
      const aKey = draftKey('note', a.editor.draftIdentity!.sessionId)
      const bKey = draftKey('note', b.editor.draftIdentity!.sessionId)
      expect(aKey).not.toBe(bKey)
      const aRaw = a.storage.getItem(aKey)
      expect(JSON.parse(aRaw!).draft.note.title).toBe('A draft')
      expect(JSON.parse(a.storage.getItem(bKey)!).draft.note.title).toBe(
        'B draft',
      )
      expect(b.editor[action]().ok).toBe(true)
      expect(a.storage.getItem(bKey)).toBeNull()
      expect(a.storage.getItem(aKey)).toBe(aRaw)
    },
  )

  it('multiple drafts require explicit selection and restore exactly the selected session', () => {
    const a = savedTab()
    const b = tab(a.storage)
    a.editor.openNote('note')
    b.editor.openNote('note')
    a.editor.changeTitle('A')
    a.editor.flushDraft()
    b.editor.changeTitle('B')
    b.editor.flushDraft()
    const fresh = tab(a.storage)
    expect(fresh.editor.openNote('note').ok).toBe(true)
    expect(fresh.editor.recoveryChoices).toHaveLength(2)
    expect(fresh.editor.recovery).toBeNull()
    expect(fresh.editor.restoreDraft().ok).toBe(false)
    expect(fresh.editor.discardRecovery().ok).toBe(false)
    expect(fresh.editor.active).toBe(false)
    const bKey = draftKey('note', b.editor.draftIdentity!.sessionId)
    expect(fresh.editor.selectRecovery(bKey).ok).toBe(true)
    expect(fresh.editor.restoreDraft().ok).toBe(true)
    expect(fresh.editor.session?.note.title).toBe('B')
    expect(fresh.editor.draftIdentity?.sessionId).toBe(
      b.editor.draftIdentity?.sessionId,
    )
    expect(fresh.editor.draftIdentity?.ownerId).not.toBe(
      b.editor.draftIdentity?.ownerId,
    )
    expect(a.persistence.findDrafts()).toMatchObject({
      ok: true,
      value: [
        { draft: { note: { title: 'A' } } },
        { draft: { note: { title: 'B' } } },
      ],
    })
  })

  it('explicit recovery transfers ownership; the old writer cannot overwrite or delete the resumed draft', () => {
    const a = savedTab()
    a.editor.openNote('note')
    a.editor.changeTitle('Before reload')
    a.editor.flushDraft()
    const fresh = tab(a.storage)
    fresh.editor.openNote('note')
    fresh.editor.restoreDraft()
    fresh.editor.changeTitle('Recovered work')
    fresh.editor.flushDraft()
    const key = draftKey('note', fresh.editor.draftIdentity!.sessionId)
    const raw = a.storage.getItem(key)
    a.editor.changeTitle('Old writer')
    expect(a.editor.flushDraft()).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(a.editor.session?.note.title).toBe('Old writer')
    expect(a.storage.getItem(key)).toBe(raw)
    expect(a.editor.cancel().ok).toBe(true)
    expect(a.storage.getItem(key)).toBe(raw)
  })

  it('retry targets the failed draft after another session starts and never removes the other tab’s draft', () => {
    const a = savedTab()
    const b = tab(a.storage)
    a.editor.openNote('note')
    b.editor.openNote('note')
    a.editor.changeTitle('A saved')
    a.editor.flushDraft()
    b.editor.changeTitle('B pending')
    b.editor.flushDraft()
    const aIdentity = a.editor.draftIdentity!
    const bKey = draftKey('note', b.editor.draftIdentity!.sessionId)
    const bRaw = a.storage.getItem(bKey)
    a.storage.removeError = namedError('SecurityError')
    expect(a.editor.save()).toMatchObject({
      ok: true,
      value: { cleanupError: { code: 'security' } },
    })
    a.storage.removeError = null
    a.notes.saveNote(createNote('other', 'Other'), null)
    a.editor.openNote('other')
    a.editor.changeTitle('Other work')
    a.editor.flushDraft()
    const otherKey = draftKey('other', a.editor.draftIdentity!.sessionId)
    const otherRaw = a.storage.getItem(otherKey)
    expect(a.editor.retryDraftCleanup(aIdentity.sessionId).ok).toBe(true)
    expect(a.storage.getItem(draftKey('note', aIdentity.sessionId))).toBeNull()
    expect(a.storage.getItem(bKey)).toBe(bRaw)
    expect(a.storage.getItem(otherKey)).toBe(otherRaw)
  })

  it('cleanup retry refuses a draft whose ownership changed after the failed Save', () => {
    const a = savedTab()
    a.editor.openNote('note')
    a.editor.changeTitle('Draft')
    a.editor.flushDraft()
    a.storage.removeError = namedError('SecurityError')
    a.editor.save()
    a.storage.removeError = null
    const fresh = tab(a.storage)
    fresh.editor.openNote('note')
    fresh.editor.restoreDraft()
    const key = draftKey('note', fresh.editor.draftIdentity!.sessionId)
    const raw = a.storage.getItem(key)
    expect(a.editor.retryDraftCleanup()).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(a.storage.getItem(key)).toBe(raw)
    expect(a.editor.pendingCleanup).not.toBeNull()
  })

  it('retains separate cleanup tasks when multiple Saves fail to remove their own drafts', () => {
    const a = savedTab()
    a.editor.openNote('note')
    a.editor.changeTitle('First')
    a.editor.flushDraft()
    a.storage.removeError = namedError('SecurityError')
    a.editor.save()
    a.storage.removeError = null
    a.notes.saveNote(createNote('other', 'Other'), null)
    a.editor.openNote('other')
    a.editor.changeTitle('Second')
    a.editor.flushDraft()
    a.storage.removeError = namedError('SecurityError')
    a.editor.save()
    expect(a.editor.cleanupTasks).toHaveLength(2)
    a.storage.removeError = null
    expect(a.editor.retryDraftCleanup().ok).toBe(true)
    expect(a.editor.cleanupTasks).toHaveLength(1)
    expect(a.persistence.findDrafts('other')).toMatchObject({
      ok: true,
      value: [{ draft: { note: { title: 'Second' } } }],
    })
    expect(a.editor.retryDraftCleanup().ok).toBe(true)
    expect(a.editor.cleanupTasks).toHaveLength(0)
    expect(a.persistence.findDrafts('other')).toEqual({ ok: true, value: [] })
  })

  it('does not discard a recovery candidate that another writer changed after it was offered', () => {
    const a = savedTab()
    a.editor.openNote('note')
    a.editor.changeTitle('Old')
    a.editor.flushDraft()
    const fresh = tab(a.storage)
    fresh.editor.openNote('note')
    a.editor.changeTitle('Newer')
    a.editor.flushDraft()
    expect(fresh.editor.discardRecovery()).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(fresh.editor.restoreDraft()).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(a.persistence.findDrafts('note')).toMatchObject({
      ok: true,
      value: [{ draft: { note: { title: 'Newer' } } }],
    })
    expect(fresh.editor.offerRecovery('note').ok).toBe(true)
    expect(fresh.editor.recovery?.note.title).toBe('Newer')
    expect(fresh.editor.restoreDraft().ok).toBe(true)
    expect(fresh.editor.session?.note.title).toBe('Newer')
  })
})

describe('recovery integrity regressions', () => {
  it('offers all drafts for explicit selection and dismisses recovery without deleting data', () => {
    const a = savedTab()
    a.editor.openNote('note')
    a.editor.changeTitle('Existing draft')
    a.editor.flushDraft()
    a.storage.data.set('todo-test:draft:%ZZ:broken', '{')
    const fresh = tab(a.storage)
    expect(fresh.editor.offerRecovery().ok).toBe(true)
    expect(fresh.editor.recoveryChoices).toHaveLength(2)
    expect(fresh.editor.recovery).toBeNull()
    const data = new Map(a.storage.data)
    expect(fresh.editor.dismissRecovery().ok).toBe(true)
    expect(fresh.editor.recoveryChoices).toEqual([])
    expect(fresh.editor.recovery).toBeNull()
    expect(a.storage.data).toEqual(data)
    expect(fresh.editor.createNew().ok).toBe(true)
    expect(fresh.editor.dismissRecovery()).toMatchObject({
      ok: false,
      error: { code: 'busy' },
    })
    expect(fresh.editor.active).toBe(true)
  })

  it('flags a stale first-save draft before restoration and prevents resurrection after remote deletion', () => {
    const a = tab()
    a.editor.createNew()
    a.editor.changeTitle('Old unsaved text')
    a.editor.addTodo('Keep task')
    a.editor.flushDraft()
    const noteId = a.editor.session!.note.id
    const key = draftKey(noteId, a.editor.draftIdentity!.sessionId)
    expect(JSON.parse(a.storage.getItem(key)!).draft.baseRevision).toBeNull()
    a.editor.changeTitle('Final saved text')
    a.storage.removeError = namedError('SecurityError')
    expect(a.editor.save()).toMatchObject({
      ok: true,
      value: { cleanupError: { code: 'security' } },
    })
    const raw = a.storage.getItem(key)
    a.storage.removeError = null
    const fresh = tab(a.storage)
    expect(fresh.editor.openNote(noteId).ok).toBe(true)
    expect(fresh.editor.recoveryConflict).toBe('changed')
    expect(fresh.editor.active).toBe(false)
    expect(fresh.editor.recovery?.note.title).toBe('Old unsaved text')
    const b = tab(a.storage)
    b.notes.load()
    expect(b.notes.deleteNote(noteId).ok).toBe(true)
    expect(fresh.editor.restoreDraft().ok).toBe(true)
    expect(fresh.editor.conflict).toBe('deleted')
    expect(fresh.editor.session?.note.title).toBe('Old unsaved text')
    expect(fresh.editor.session?.note.todos[0]?.text).toBe('Keep task')
    expect(fresh.editor.save()).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
    expect(fresh.persistence.loadNotes()).toEqual({ ok: true, value: [] })
    expect(a.storage.getItem(key)).not.toBeNull()
    expect(JSON.parse(a.storage.getItem(key)!).draft.note).toEqual(
      JSON.parse(raw!).draft.note,
    )
    const again = tab(a.storage)
    again.editor.openNote(noteId)
    expect(again.editor.recoveryConflict).toBe('deleted')
    again.editor.restoreDraft()
    expect(again.editor.save().ok).toBe(false)
  })

  it('a tombstone rejects baseRevision null directly and survives unrelated writes/reinitialization', () => {
    const a = savedTab()
    a.notes.deleteNote('note')
    a.notes.saveNote(createNote('other', 'Other'), null)
    const fresh = tab(a.storage)
    expect(fresh.notes.saveNote(original, null)).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
    expect(JSON.parse(a.storage.getItem(NOTES_KEY)!).deletedNoteIds).toEqual([
      'note',
    ])
    fresh.notes.load()
    expect(fresh.notes.notes.map((note) => note.id)).toEqual(['other'])
  })

  it('restores a genuinely new draft, saves the original IDs and clears only that resumed draft', () => {
    const a = tab()
    a.editor.createNew()
    a.editor.changeTitle('Never saved')
    a.editor.addTodo('Task')
    a.editor.flushDraft()
    const working = a.editor.session!.note
    const fresh = tab(a.storage)
    fresh.editor.offerRecovery(working.id)
    expect(fresh.editor.recoveryConflict).toBeNull()
    expect(fresh.editor.active).toBe(false)
    expect(fresh.editor.restoreDraft().ok).toBe(true)
    expect(fresh.editor.save().ok).toBe(true)
    expect(fresh.notes.getNote(working.id)).toEqual(working)
    expect(fresh.persistence.findDrafts(working.id)).toEqual({
      ok: true,
      value: [],
    })
  })

  it('first Save failure on a new note preserves IDs/history; retry creates exactly one saved note', () => {
    const { editor, notes, storage, persistence, newId } = tab()
    editor.createNew()
    editor.changeTitle('New')
    editor.addTodo('Todo')
    editor.flushDraft()
    const working = editor.session!.note
    storage.writeError = namedError('QuotaExceededError')
    expect(editor.save()).toMatchObject({ ok: false, error: { code: 'quota' } })
    expect(notes.notes).toEqual([])
    expect(editor.session?.note).toEqual(working)
    expect(editor.undoAvailable).toBe(true)
    storage.writeError = null
    expect(editor.save().ok).toBe(true)
    expect(notes.notes).toEqual([working])
    expect(persistence.loadNotes()).toMatchObject({
      ok: true,
      value: [{ note: working }],
    })
    expect(editor.save()).toMatchObject({
      ok: false,
      error: { code: 'inactive' },
    })
    expect(notes.notes).toHaveLength(1)
    expect(newId).toHaveBeenCalledTimes(2)
  })

  it.each(['{', '{"schemaVersion":99}'])(
    'exposes unreadable draft identity and requires explicit deletion: %s',
    (raw) => {
      const a = savedTab()
      const key = draftKey('note', 'damaged-session')
      a.storage.data.set(key, raw)
      const fresh = tab(a.storage)
      expect(fresh.editor.openNote('note')).toMatchObject({
        ok: false,
        error: { code: raw === '{' ? 'invalid-json' : 'unsupported-version' },
      })
      expect(fresh.editor.recoveryChoices).toMatchObject([
        {
          id: key,
          noteId: 'note',
          error: { code: raw === '{' ? 'invalid-json' : 'unsupported-version' },
        },
      ])
      expect(a.storage.getItem(key)).toBe(raw)
      a.storage.removeError = namedError('SecurityError')
      expect(fresh.editor.discardCorruptedDraft(key)).toMatchObject({
        ok: false,
        error: { code: 'security' },
      })
      expect(a.storage.getItem(key)).toBe(raw)
      a.storage.removeError = null
      expect(fresh.editor.discardCorruptedDraft(key).ok).toBe(true)
      expect(a.storage.getItem(key)).toBeNull()
      expect(fresh.editor.openNote('note').ok).toBe(true)
      expect(fresh.editor.session?.note).toEqual(original)
    },
  )

  it('deleting one damaged draft preserves other sessions and rejects a changed candidate', () => {
    const a = savedTab()
    a.editor.openNote('note')
    a.editor.changeTitle('Valid draft')
    a.editor.flushDraft()
    const validKey = draftKey('note', a.editor.draftIdentity!.sessionId)
    const validRaw = a.storage.getItem(validKey)
    const damagedKey = draftKey('note', 'broken')
    a.storage.data.set(damagedKey, '{')
    const fresh = tab(a.storage)
    fresh.editor.openNote('note')
    a.storage.data.set(damagedKey, '{newer')
    expect(fresh.editor.discardCorruptedDraft(damagedKey)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(a.storage.getItem(damagedKey)).toBe('{newer')
    expect(a.storage.getItem(validKey)).toBe(validRaw)
    const next = tab(a.storage)
    next.editor.openNote('note')
    expect(next.editor.discardCorruptedDraft(damagedKey).ok).toBe(true)
    expect(a.storage.getItem(validKey)).toBe(validRaw)
    expect(next.editor.recoveryChoices).toHaveLength(1)
  })

  it('a failed ownership transfer keeps recovery data and the original draft intact', () => {
    const a = savedTab()
    a.editor.openNote('note')
    a.editor.changeTitle('Keep me')
    a.editor.flushDraft()
    const key = draftKey('note', a.editor.draftIdentity!.sessionId)
    const raw = a.storage.getItem(key)
    const fresh = tab(a.storage)
    fresh.editor.openNote('note')
    a.storage.writeError = namedError('QuotaExceededError')
    expect(fresh.editor.restoreDraft()).toMatchObject({
      ok: false,
      error: { code: 'quota' },
    })
    expect(fresh.editor.active).toBe(false)
    expect(fresh.editor.recovery?.note.title).toBe('Keep me')
    expect(a.storage.getItem(key)).toBe(raw)
    a.storage.writeError = null
    expect(fresh.editor.restoreDraft().ok).toBe(true)
  })
})
