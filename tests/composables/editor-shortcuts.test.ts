import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorShortcuts } from '../../app/composables/useEditorShortcuts'

const lifecycle = vi.hoisted(() => ({
  mount: undefined as (() => void) | undefined,
  unmount: undefined as (() => void) | undefined,
}))
vi.mock('vue', () => ({
  onMounted: (callback: () => void) => {
    lifecycle.mount = callback
  },
  onBeforeUnmount: (callback: () => void) => {
    lifecycle.unmount = callback
  },
}))

class EditableTarget {
  closest = vi.fn((): object | null => this)
}

class InputTarget extends EditableTarget {
  constructor(readonly type: string) {
    super()
  }
}

let keydown: ((event: KeyboardEvent) => void) | undefined
const addEventListener = vi.fn(
  (type: string, listener: (event: KeyboardEvent) => void) => {
    if (type === 'keydown') keydown = listener
  },
)
const removeEventListener = vi.fn()
const querySelector = vi.fn((): object | null => null)

beforeEach(() => {
  vi.clearAllMocks()
  keydown = undefined
  lifecycle.mount = undefined
  lifecycle.unmount = undefined
  querySelector.mockReturnValue(null)
  vi.stubGlobal('Element', EditableTarget)
  vi.stubGlobal('HTMLInputElement', InputTarget)
  vi.stubGlobal('document', {
    addEventListener,
    removeEventListener,
    querySelector,
  })
})
afterEach(() => vi.unstubAllGlobals())

function shortcuts() {
  const undo = vi.fn()
  const redo = vi.fn()
  let enabled = true
  useEditorShortcuts({ enabled: () => enabled, undo, redo })
  lifecycle.mount?.()
  return {
    undo,
    redo,
    disable: () => {
      enabled = false
    },
  }
}
function press(overrides: Partial<KeyboardEvent> = {}) {
  const event = {
    key: 'z',
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    preventDefault: vi.fn(),
    ...overrides,
  }
  keydown?.(event as unknown as KeyboardEvent)
  return event
}

describe('editor shortcuts', () => {
  it.each([
    { ctrlKey: true, metaKey: false },
    { ctrlKey: false, metaKey: true },
  ])('handles Undo/Redo with modifier %j once per event', (modifiers) => {
    const { undo, redo } = shortcuts()
    expect(press(modifiers).preventDefault).toHaveBeenCalledOnce()
    expect(undo).toHaveBeenCalledOnce()
    expect(
      press({ ...modifiers, key: 'Z', shiftKey: true }).preventDefault,
    ).toHaveBeenCalledOnce()
    expect(redo).toHaveBeenCalledOnce()
  })

  it.each([
    { ctrlKey: false },
    { altKey: true },
    { isComposing: true },
    { defaultPrevented: true },
    { key: 's' },
  ])(
    'leaves unrelated or already handled events untouched: %j',
    (overrides) => {
      const { undo, redo } = shortcuts()
      expect(press(overrides).preventDefault).not.toHaveBeenCalled()
      expect(undo).not.toHaveBeenCalled()
      expect(redo).not.toHaveBeenCalled()
    },
  )

  it('preserves native text editing and dialog keyboard handling', () => {
    const { undo, redo } = shortcuts()
    const target = new EditableTarget()
    expect(
      press({ target: target as unknown as EventTarget }).preventDefault,
    ).not.toHaveBeenCalled()
    expect(target.closest).toHaveBeenCalledWith(
      'input, textarea, [contenteditable]:not([contenteditable="false"])',
    )
    querySelector.mockReturnValue({})
    expect(press().preventDefault).not.toHaveBeenCalled()
    expect(undo).not.toHaveBeenCalled()
    expect(redo).not.toHaveBeenCalled()
  })

  it('reads the current enabled state rather than capturing it at mount', () => {
    const { undo, disable } = shortcuts()
    press()
    disable()
    expect(press().preventDefault).not.toHaveBeenCalled()
    expect(undo).toHaveBeenCalledOnce()
  })

  it.each([
    'checkbox',
    'radio',
    'button',
    'submit',
    'reset',
    'range',
    'color',
    'file',
    'image',
  ])('supports global Undo/Redo while a %s input has focus', (type) => {
    const { undo, redo } = shortcuts()
    const target = new InputTarget(type) as unknown as EventTarget
    expect(press({ target }).preventDefault).toHaveBeenCalledOnce()
    expect(undo).toHaveBeenCalledOnce()
    expect(
      press({ target, shiftKey: true }).preventDefault,
    ).toHaveBeenCalledOnce()
    expect(redo).toHaveBeenCalledOnce()
  })

  it.each(['text', 'search', 'email', 'password', 'url', 'tel', 'number'])(
    'preserves native Undo/Redo in a %s input',
    (type) => {
      const { undo, redo } = shortcuts()
      const target = new InputTarget(type) as unknown as EventTarget
      expect(press({ target }).preventDefault).not.toHaveBeenCalled()
      expect(
        press({ target, shiftKey: true }).preventDefault,
      ).not.toHaveBeenCalled()
      expect(undo).not.toHaveBeenCalled()
      expect(redo).not.toHaveBeenCalled()
    },
  )

  it('registers on mount and removes the same listener on unmount', () => {
    const undo = vi.fn()
    useEditorShortcuts({ enabled: () => true, undo, redo: vi.fn() })
    expect(addEventListener).not.toHaveBeenCalled()
    lifecycle.mount?.()
    expect(addEventListener).toHaveBeenCalledOnce()
    lifecycle.unmount?.()
    expect(removeEventListener).toHaveBeenCalledExactlyOnceWith(
      'keydown',
      keydown,
    )
  })
})
