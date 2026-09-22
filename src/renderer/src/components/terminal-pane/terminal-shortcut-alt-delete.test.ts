import { describe, expect, it } from 'vitest'
import {
  resolveTerminalShortcutAction,
  type TerminalShortcutEvent
} from './terminal-shortcut-policy'

function event(overrides: Partial<TerminalShortcutEvent>): TerminalShortcutEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides
  }
}

// iTerm2 maps Option+ForwardDelete to readline's forward-kill-word (Alt+D) instead of
// the faithful CSI 3;3~ xterm emits. TUIs that decode the faithful sequence directly —
// Claude Code's readline is one — read it as delete-to-end-of-line instead of one word.
describe('Option+ForwardDelete', () => {
  it('sends readline forward-kill-word instead of the faithful CSI sequence', () => {
    expect(resolveTerminalShortcutAction(event({ key: 'Delete', altKey: true }), true)).toEqual({
      type: 'sendInput',
      data: '\x1bd'
    })
  })

  it('yields to a kitty-protocol pane, matching the Alt+Backspace treatment', () => {
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'Delete', code: 'Delete', altKey: true }),
        true,
        'false',
        0,
        false,
        undefined,
        undefined,
        () => 1
      )
    ).toBeNull()
  })

  it('does not intercept a NumLock-off numpad decimal key reporting as Delete', () => {
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'Delete', code: 'NumpadDecimal', altKey: true }),
        true,
        'false',
        0,
        false,
        undefined,
        undefined,
        () => 0
      )
    ).not.toEqual({ type: 'sendInput', data: '\x1bd' })
  })
})
