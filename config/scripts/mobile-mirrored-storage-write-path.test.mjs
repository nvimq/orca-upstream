/**
 * One owner for the mirror the hybrid shell reads (ruling 35).
 *
 * `mirrored-storage-keys.ts` holds the map the shell builds every `init` from, synchronously, and
 * before this the fourteen writers of a mirrored key noted it themselves — first, then persisted.
 * On the page a persist can be refused, so twelve of them left the map holding a value no store
 * had taken and the next `init` handed the page exactly that; the other two undid it by hand.
 *
 * Source-scanning rather than behavioural, and about existence rather than shape: what a
 * behavioural case cannot say is that no thirteenth writer appears next week. Each row below is a
 * module that owns a mirrored key, so deleting its write path reds that row by name, and every
 * failure quotes the line it found.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const mobileDir = fileURLToPath(new URL('../../mobile/', import.meta.url))

const MIRROR_MODULE = 'src/storage/mirrored-storage-keys.ts'

/** Every module that persists a key the shell mirrors, with the constant each one writes. */
const MIRRORED_WRITERS = [
  { file: 'src/storage/preferences.ts', keys: ['TEXT_SCALE_KEY', 'SIDEBAR_WIDTH_KEY', 'DOCK_WIDTH_KEY'] },
  { file: 'src/storage/session-view-preferences.ts', keys: ['DEFAULT_SESSION_VIEW_KEY'] },
  { file: 'src/terminal/terminal-accessory-layout.ts', keys: ['TERMINAL_ACCESSORY_LAYOUT_STORAGE_KEY'] },
  { file: 'src/components/CustomKeyModal.tsx', keys: ['CUSTOM_ACCESSORY_KEYS_STORAGE_KEY'] },
  { file: 'src/session/mobile-structured-send-operation-journal.ts', keys: ['STORAGE_KEY'] }
]

/** The line a match sits on, so a failure names what it found rather than only that it found one. */
function linesMatching(source, pattern) {
  return source
    .split('\n')
    .map((line, index) => ({ line: line.trim(), at: index + 1 }))
    .filter((entry) => pattern.test(entry.line))
}

function read(file) {
  return readFileSync(new URL(file, new URL(mobileDir, 'file:///')), 'utf8')
}

describe('the mirrored storage write path', () => {
  it('is the only thing that writes the map, which no other module can reach', () => {
    const owner = read(MIRROR_MODULE)
    // The map itself: a second module holding a reference to it would be a second owner, and the
    // map is not exported, so this is what says so.
    expect(linesMatching(owner, /^export (const|let) mirror\b/)).toEqual([])
    expect(linesMatching(owner, /^export function note\b/)).toEqual([])
  })

  for (const row of MIRRORED_WRITERS) {
    it(`writes ${row.file} through the one path and never around it`, () => {
      const source = read(row.file)
      expect(linesMatching(source, /\bpersistMirrored\(/).length).toBeGreaterThan(0)
      // Around it would be a store call naming a key the map holds, which is the shape every one
      // of these had before: note the map, then persist, and nothing between the two agreeing.
      for (const key of row.keys) {
        expect(
          linesMatching(source, new RegExp(`AsyncStorage\\.(setItem|removeItem)\\(\\s*${key}\\b`)),
          `${row.file} writes ${key} past the mirror`
        ).toEqual([])
      }
      expect(linesMatching(source, /\bnoteMirroredWrite\b/), `${row.file} notes the map itself`)
        .toEqual([])
    })
  }
})
