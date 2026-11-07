import { describe, expect, it } from 'vitest'
import { createNote } from '../../app/domain/models/note'
import { createTodo } from '../../app/domain/models/todo'
import {
  decodeCollection,
  decodeDraft,
  encodeDraft,
  encodeNotes,
} from '../../app/persistence/codec'
import {
  createPersistence,
  draftKey,
  NOTES_KEY,
} from '../../app/persistence/storage'
import { MemoryStorage, namedError } from '../helpers/storage'

const note = createNote('note', 'Plan', [
  createTodo('two', 'Read', true),
  createTodo('one', 'Write'),
])
const entry = { note, revision: 'rev-1' }
const draft = {
  note: createNote('note', '', [createTodo('todo')]),
  baseRevision: 'rev-1',
  updatedAt: 42,
  sessionId: 'session',
  ownerId: 'owner',
}
const identity = { noteId: 'note', sessionId: 'session', ownerId: 'owner' }

describe('persistence codecs', () => {
  it('round-trips the versioned saved collection preserving IDs and order', () => {
    const raw = encodeNotes([entry])
    expect(JSON.parse(raw).schemaVersion).toBe(1)
    const decoded = decodeCollection(raw)
    expect(decoded).toEqual({
      ok: true,
      value: { notes: [entry], deletedNoteIds: [] },
    })
    if (decoded.ok) {
      expect(Object.isFrozen(decoded.value.notes)).toBe(true)
      expect(Object.isFrozen(decoded.value.notes[0]?.note.todos[0])).toBe(true)
    }
  })

  it('round-trips incomplete drafts and their baseline metadata without history', () => {
    const raw = encodeDraft(draft)
    expect(JSON.parse(raw).schemaVersion).toBe(1)
    expect(decodeDraft(raw)).toEqual({ ok: true, value: draft })
    expect(raw).not.toContain('undoStack')
  })

  it.each([
    ['{', 'invalid-json'],
    ['null', 'invalid-data'],
    ['[]', 'invalid-data'],
    ['{}', 'invalid-data'],
    ['{"schemaVersion":99,"notes":[]}', 'unsupported-version'],
    ['{"schemaVersion":1,"notes":{}}', 'invalid-data'],
  ])('rejects invalid envelopes: %s', (raw, code) => {
    expect(decodeCollection(raw)).toMatchObject({ ok: false, error: { code } })
  })

  it.each([
    [{ ...entry, revision: '' }],
    [{ ...entry, note: { ...note, id: '' } }],
    [{ ...entry, note: { ...note, title: '  ' } }],
    [
      {
        ...entry,
        note: { ...note, todos: [{ id: 'a', text: ' ', completed: false }] },
      },
    ],
    [
      {
        ...entry,
        note: {
          ...note,
          todos: [{ id: 'a', text: 'Task', completed: 'true' }],
        },
      },
    ],
    [{ ...entry, note: { ...note, todos: [note.todos[0], note.todos[0]] } }],
    [entry, entry],
    [null],
  ])('rejects invalid saved entries %#', (...notes) => {
    expect(
      decodeCollection(
        JSON.stringify({ schemaVersion: 1, notes, deletedNoteIds: [] }),
      ),
    ).toMatchObject({ ok: false, error: { code: 'invalid-data' } })
  })

  it.each([
    { ...draft, baseRevision: '' },
    { ...draft, updatedAt: -1 },
    { ...draft, updatedAt: '42' },
    { ...draft, note: { ...note, todos: [null] } },
  ])('rejects invalid draft metadata/structure %#', (invalid) => {
    expect(
      decodeDraft(JSON.stringify({ schemaVersion: 1, draft: invalid })),
    ).toMatchObject({ ok: false, error: { code: 'invalid-data' } })
  })
})

describe('storage boundary', () => {
  it('loads an absent collection without writing', () => {
    const storage = new MemoryStorage()
    expect(createPersistence(() => storage).loadNotes()).toEqual({
      ok: true,
      value: [],
    })
    expect(storage.writes).toEqual([])
  })

  it.each([
    ['SecurityError', 'security'],
    ['QuotaExceededError', 'quota'],
    ['Error', 'storage'],
  ])(
    'reports %s for read/write/remove without corrupting existing data',
    (name, code) => {
      const storage = new MemoryStorage()
      const persistence = createPersistence(() => storage)
      storage.data.set(NOTES_KEY, encodeNotes([entry]))
      storage.writeError = namedError(name)
      expect(
        persistence.saveNote({ ...note, title: 'Changed' }, 'rev-1'),
      ).toMatchObject({ ok: false, error: { code } })
      expect(storage.data.get(NOTES_KEY)).toBe(encodeNotes([entry]))
      storage.readError = namedError(name)
      expect(persistence.loadNotes()).toMatchObject({
        ok: false,
        error: { code },
      })
      storage.readError = null
      storage.writeError = null
      persistence.saveDraft(draft)
      storage.removeError = namedError(name)
      expect(persistence.removeDraft(identity)).toMatchObject({
        ok: false,
        error: { code },
      })
    },
  )

  it('handles unavailable storage and a throwing localStorage accessor', () => {
    expect(createPersistence(() => null).loadNotes()).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    })
    expect(
      createPersistence(() => {
        throw namedError('SecurityError')
      }).loadNotes(),
    ).toMatchObject({ ok: false, error: { code: 'security' } })
  })

  it.each(['{', '{"schemaVersion":99,"notes":[]}'])(
    'does not overwrite unreadable collection %s',
    (raw) => {
      const storage = new MemoryStorage()
      storage.data.set(NOTES_KEY, raw)
      const persistence = createPersistence(() => storage)
      expect(persistence.loadNotes().ok).toBe(false)
      expect(persistence.saveNote(note, null).ok).toBe(false)
      expect(persistence.deleteNote(note.id, 'rev-1').ok).toBe(false)
      expect(storage.data.get(NOTES_KEY)).toBe(raw)
      expect(storage.writes).toEqual([])
    },
  )

  it('re-reads and merges other notes on save and delete', () => {
    const storage = new MemoryStorage()
    let revision = 0
    const a = createPersistence(
      () => storage,
      () => `rev-${++revision}`,
    )
    const b = createPersistence(
      () => storage,
      () => `rev-${++revision}`,
    )
    a.saveNote(note, null)
    const old = a.loadNotes()
    b.saveNote(createNote('other', 'Other'), null)
    expect(a.saveNote({ ...note, title: 'New' }, 'rev-1')).toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          note: expect.objectContaining({ title: 'New' }),
        }),
        expect.objectContaining({
          note: expect.objectContaining({ id: 'other' }),
        }),
      ],
    })
    expect(old).toMatchObject({ ok: true, value: [entry] })
    b.saveNote(createNote('third', 'Third'), null)
    expect(a.deleteNote('note', 'rev-3')).toMatchObject({
      ok: true,
      value: [
        expect.objectContaining({
          note: expect.objectContaining({ id: 'other' }),
        }),
        expect.objectContaining({
          note: expect.objectContaining({ id: 'third' }),
        }),
      ],
    })
  })

  it('rejects duplicate new IDs, stale revisions and repeated deletions', () => {
    const storage = new MemoryStorage()
    const p = createPersistence(
      () => storage,
      () => 'rev-1',
    )
    p.saveNote(note, null)
    expect(p.saveNote(note, null)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(p.saveNote(note, 'stale')).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(p.deleteNote('note', 'stale')).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    })
    expect(p.deleteNote('note', 'rev-1').ok).toBe(true)
    expect(p.deleteNote('note', 'rev-1')).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
    expect(p.saveNote(note, 'rev-1')).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    })
  })

  it('validates save without losing the original whitespace', () => {
    const storage = new MemoryStorage()
    const p = createPersistence(() => storage)
    expect(p.saveNote(createNote('new', '  '), null)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    })
    expect(
      p.saveNote(createNote('new', 'Title', [createTodo('t', '\t')]), null),
    ).toMatchObject({ ok: false, error: { code: 'validation' } })
    expect(storage.writes).toEqual([])
  })

  it('discovers drafts for saved and new notes, ignoring unrelated keys', () => {
    const storage = new MemoryStorage()
    const p = createPersistence(() => storage)
    p.saveDraft(draft)
    const newDraft = {
      ...draft,
      note: createNote('new/id'),
      baseRevision: null,
    }
    p.saveDraft(newDraft)
    storage.data.set('unrelated', 'invalid')
    expect(p.findDrafts('note')).toMatchObject({ ok: true, value: [{ draft }] })
    expect(p.findDrafts()).toMatchObject({
      ok: true,
      value: [{ draft }, { draft: newDraft }],
    })
    expect(storage.data.has(draftKey('new/id', draft.sessionId))).toBe(true)
    p.removeDraft(identity)
    expect(p.findDrafts('note')).toEqual({ ok: true, value: [] })
  })

  it('does not overwrite malformed/unknown drafts; permits explicit removal', () => {
    const storage = new MemoryStorage()
    const p = createPersistence(() => storage)
    storage.data.set(draftKey('note', draft.sessionId), '{"schemaVersion":5}')
    expect(p.saveDraft(draft)).toMatchObject({
      ok: false,
      error: { code: 'unsupported-version' },
    })
    expect(p.findDrafts()).toMatchObject({
      ok: true,
      value: [{ error: { code: 'unsupported-version' } }],
    })
    expect(storage.writes).toEqual([])
    const candidates = p.findDrafts('note')
    if (!candidates.ok) throw new Error('Expected draft metadata')
    expect(p.discardDraft(candidates.value[0]!).ok).toBe(true)
  })

  it('rejects a draft stored under the wrong ID', () => {
    const storage = new MemoryStorage()
    const p = createPersistence(() => storage)
    storage.data.set(draftKey('other', draft.sessionId), encodeDraft(draft))
    expect(p.findDrafts('other')).toMatchObject({
      ok: true,
      value: [{ error: { code: 'invalid-data' } }],
    })
    expect(p.findDrafts()).toMatchObject({
      ok: true,
      value: [{ error: { code: 'invalid-data' } }],
    })
  })
})

describe('current schema validation', () => {
  it.each([
    {
      raw: JSON.stringify({ schemaVersion: 1, notes: [entry] }),
      code: 'invalid-data',
    },
    {
      raw: JSON.stringify({
        schemaVersion: 2,
        notes: [entry],
        deletedNoteIds: [],
      }),
      code: 'unsupported-version',
    },
  ])(
    'rejects incompatible collections without rewriting them: $code',
    ({ raw, code }) => {
      const storage = new MemoryStorage()
      storage.data.set(NOTES_KEY, raw)
      const p = createPersistence(() => storage)
      expect(p.loadNotes()).toMatchObject({ ok: false, error: { code } })
      expect(p.saveNote(note, 'rev-1')).toMatchObject({
        ok: false,
        error: { code },
      })
      expect(p.deleteNote(note.id, 'rev-1')).toMatchObject({
        ok: false,
        error: { code },
      })
      expect(storage.getItem(NOTES_KEY)).toBe(raw)
      expect(storage.writes).toEqual([])
    },
  )

  it.each([
    {
      raw: JSON.stringify({
        schemaVersion: 1,
        draft: { note: draft.note, baseRevision: null, updatedAt: 42 },
      }),
      code: 'invalid-data',
    },
    {
      raw: JSON.stringify({ schemaVersion: 2, draft }),
      code: 'unsupported-version',
    },
  ])(
    'exposes incompatible drafts without restoring or replacing them: $code',
    ({ raw, code }) => {
      const storage = new MemoryStorage()
      const key = draftKey(draft.note.id, draft.sessionId)
      storage.data.set(key, raw)
      const p = createPersistence(() => storage)
      expect(p.findDrafts()).toMatchObject({
        ok: true,
        value: [{ id: key, draft: null, error: { code } }],
      })
      expect(p.saveDraft(draft)).toMatchObject({ ok: false, error: { code } })
      expect(p.removeDraft(identity)).toMatchObject({
        ok: false,
        error: { code },
      })
      expect(storage.getItem(key)).toBe(raw)
      expect(storage.writes).toEqual([])
    },
  )

  it.each(
    [undefined, [''], ['deleted', 'deleted'], ['note'], [42]].map(
      (deletedNoteIds) => ({ deletedNoteIds }),
    ),
  )(
    'rejects invalid tombstones rather than silently dropping deletion history %#',
    ({ deletedNoteIds }) => {
      expect(
        decodeCollection(
          JSON.stringify({ schemaVersion: 1, notes: [entry], deletedNoteIds }),
        ),
      ).toMatchObject({ ok: false, error: { code: 'invalid-data' } })
    },
  )

  it.each(['sessionId', 'ownerId'] as const)(
    'rejects empty %s rather than treating it as a new draft',
    (field) => {
      const invalid = { ...draft, [field]: '' }
      expect(
        decodeDraft(JSON.stringify({ schemaVersion: 1, draft: invalid })),
      ).toMatchObject({ ok: false, error: { code: 'invalid-data' } })
    },
  )

  it('a failed deletion write preserves both the note and deletion metadata', () => {
    const storage = new MemoryStorage()
    const p = createPersistence(
      () => storage,
      () => 'rev-1',
    )
    p.saveNote(note, null)
    const raw = storage.getItem(NOTES_KEY)
    storage.writeError = namedError('QuotaExceededError')
    expect(p.deleteNote('note', 'rev-1')).toMatchObject({
      ok: false,
      error: { code: 'quota' },
    })
    expect(storage.getItem(NOTES_KEY)).toBe(raw)
    expect(p.loadNotes()).toEqual({ ok: true, value: [entry] })
  })
})
