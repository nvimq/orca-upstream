/**
 * The six grants that were pinned only by the list they were copied from (ruling 33.3).
 *
 * `haptics`, `screencastBinary` and the four audio grants already have call-site censuses of their
 * own; these six did not, so removing any of them from a manifest entry reddened nothing. Each row
 * below gets its own named case, and each case's control is the same rule driven over the entry
 * that route would have had with the grant struck out.
 */
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { mobileWebAppRouteClosure } from './build-mobile-web-app-bundle.mjs'
import { mobileWebAppDependenciesPresent } from './mobile-web-app-bundle-dependencies.mjs'
import {
  PAGE_ROUTE_MODULES,
  pageRouteModulesCoverTheManifest
} from './mobile-web-app-page-route-modules.mjs'
import { MOBILE_WEB_PAGE_ROUTES } from './mobile-web-page-routes.mjs'
import {
  PAGE_GRANT_CALL_SITES,
  grantCallSites,
  grantsMissingForRoutes,
  grantsNeeded,
  moduleReachesGrantRow
} from './mobile-web-app-page-grant-call-sites.mjs'

const mobileDir = fileURLToPath(new URL('../../mobile/', import.meta.url))
const describeClosure = mobileWebAppDependenciesPresent() ? describe : describe.skip

const SESSION = '/h/[hostId]/session/[worktreeId]'

function closureOf(pathname) {
  const mod = PAGE_ROUTE_MODULES.get(pathname)
  if (mod === undefined) {
    throw new Error(`${pathname} has no route module, so no closure can be read for it`)
  }
  return mobileWebAppRouteClosure(mod)
}

/**
 * The one place a page route reaches a seam it does not declare, recorded rather than exempted.
 *
 * `app/h/_layout.tsx` wraps every `/h` route in `HostProtocolGate`, whose `ProtocolBlockScreen`
 * offers an Update Orca link through `openExternalLink`. Six routes declare `externalLink` and two
 * do not, so on those two the wall's link posts a notify the shell refuses — a dead tap with
 * nothing on screen. Pre-existing on main and not C7.7's to change: widening two other routes'
 * grants is a capability decision, and this lane reports rather than fixes it.
 *
 * Exact, so it reds in both directions: adding the grant to either route empties an entry here and
 * a new gap anywhere adds one.
 */
const KNOWN_UNDECLARED = [
  '/h/[hostId] needs externalLink',
  '/h/[hostId]/agent-history/[worktreeId] needs externalLink'
]

describe('the call-site reader', () => {
  const navigate = PAGE_GRANT_CALL_SITES[0]
  const storage = PAGE_GRANT_CALL_SITES[1]

  it('counts a call and not an import that never calls it', () => {
    expect(
      moduleReachesGrantRow(
        "import { useRouteHandoff } from '../navigation/route-handoff'\nexport { useRouteHandoff }\n",
        'a.ts',
        navigate
      )
    ).toBe(false)
    expect(
      moduleReachesGrantRow(
        "import { useRouteHandoff } from '../navigation/route-handoff'\nconst r = useRouteHandoff()\n",
        'a.ts',
        navigate
      )
    ).toBe(true)
  })

  it('ignores the seam named in a comment or a string, which text matching cannot', () => {
    expect(
      moduleReachesGrantRow(
        ['// const r = useRouteHandoff()', 'const hint = "useRouteHandoff()"'].join('\n'),
        'a.ts',
        navigate
      )
    ).toBe(false)
  })

  it('reads a .tsx file as TSX, so nothing after the first element is swallowed', () => {
    expect(
      moduleReachesGrantRow(
        ['export const view = <View />', 'export const use = () => useRouteHandoff()'].join('\n'),
        'a.tsx',
        navigate
      )
    ).toBe(true)
  })

  it('counts the substituted module as reached when it is imported at all', () => {
    expect(
      moduleReachesGrantRow(
        "import AsyncStorage from '@react-native-async-storage/async-storage'\n",
        'a.ts',
        storage
      )
    ).toBe(true)
    expect(
      moduleReachesGrantRow("import AsyncStorage from './other-storage'\n", 'a.ts', storage)
    ).toBe(false)
  })

  it('names six rows covering eight grants, none of them a grant another census owns', () => {
    const grants = PAGE_GRANT_CALL_SITES.flatMap((row) => row.grants)
    expect(PAGE_GRANT_CALL_SITES).toHaveLength(6)
    expect(grants).toEqual([
      'navigate',
      'storage',
      'externalLink',
      'native.clipboard.write',
      'native.clipboard.read',
      'native.media.pick',
      'native.media.read',
      'native.media.release'
    ])
    for (const owned of ['haptics', 'screencastBinary', 'native.audio.start']) {
      expect(grants).not.toContain(owned)
    }
  })
})

describeClosure(
  'what each page route reaches, against what it declared',
  () => {
    it('covers every declared page route, so a new one cannot be missed by this file', () => {
      const { mapped, declared } = pageRouteModulesCoverTheManifest(MOBILE_WEB_PAGE_ROUTES)
      expect(mapped).toEqual(declared)
    })

    it('holds every registered page route to the grants its own call sites need', async () => {
      expect(await grantsMissingForRoutes(mobileDir, MOBILE_WEB_PAGE_ROUTES, closureOf)).toEqual(
        KNOWN_UNDECLARED
      )
    })

    /**
     * One case per row, each the control for its own grant: the same rule, driven over the session
     * entry with that grant struck out. This is what makes removing any one of the six red a case
     * named after it rather than nothing at all.
     */
    it.each(PAGE_GRANT_CALL_SITES.map((row) => [row.grants.join(' + '), row]))(
      'reds the session route when it is registered without %s',
      async (_name, row) => {
        const session = MOBILE_WEB_PAGE_ROUTES.find((route) => route.pathname === SESSION)
        expect(session, 'the session route is registered').toBeDefined()
        const without = session.grants.filter((grant) => !row.grants.includes(grant))
        expect(without.length, 'the session route declares every grant in this row').toBe(
          session.grants.length - row.grants.length
        )
        expect(
          await grantsMissingForRoutes(
            mobileDir,
            [{ pathname: SESSION, grants: without }],
            closureOf
          )
        ).toEqual(row.grants.map((grant) => `${SESSION} needs ${grant}`))
        // And with them it passes, so each case is a rule and not a wall.
        expect(
          await grantsMissingForRoutes(
            mobileDir,
            [{ pathname: SESSION, grants: session.grants }],
            closureOf
          )
        ).toEqual([])
      }
    )

    it('reaches every one of the eight through the session route, and names where', async () => {
      const closure = await closureOf(SESSION)
      // The precondition an assertion about a closure needs: the walk read a page, not nothing.
      expect(closure.local.length).toBeGreaterThan(250)
      expect(grantsNeeded(mobileDir, closure)).toEqual(
        PAGE_GRANT_CALL_SITES.flatMap((row) => row.grants)
      )
      for (const row of PAGE_GRANT_CALL_SITES) {
        expect(
          grantCallSites(mobileDir, closure, row).length,
          row.grants.join(' + ')
        ).toBeGreaterThan(0)
      }
    })

    it('finds the clipboard reader and the media picker on the session route alone', async () => {
      const readerRow = PAGE_GRANT_CALL_SITES[4]
      const mediaRow = PAGE_GRANT_CALL_SITES[5]
      const reaching = { reader: [], media: [] }
      for (const pathname of PAGE_ROUTE_MODULES.keys()) {
        const closure = await closureOf(pathname)
        if (grantCallSites(mobileDir, closure, readerRow).length > 0) {
          reaching.reader.push(pathname)
        }
        if (grantCallSites(mobileDir, closure, mediaRow).length > 0) {
          reaching.media.push(pathname)
        }
      }
      // Both are the session screen's and nowhere else's, which is why no other route carries them.
      expect(reaching.reader).toEqual([SESSION])
      expect(reaching.media).toEqual([SESSION])
    })
  },
  240_000
)
