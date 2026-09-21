import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BridgeInitRoute } from '../mobile-web-shell/bridge/bridge-envelope'
import type { MobileSessionTab } from './mobile-session-route-types'

type RouteUpdateListener = (route: BridgeInitRoute | null) => void

const bridge = vi.hoisted(() => {
  const held: {
    route: BridgeInitRoute | null
    listeners: RouteUpdateListener[]
  } = { route: null, listeners: [] }
  return held
})

vi.mock('../transport/client-context.web', () => ({
  usePageBridgeClient: () => ({
    getShellSession: () => ({ route: bridge.route }),
    onRouteUpdate: (listener: RouteUpdateListener) => {
      bridge.listeners.push(listener)
      return () => {
        bridge.listeners = bridge.listeners.filter((held) => held !== listener)
      }
    }
  })
}))

import { useNotificationPaneNavigation } from './use-notification-pane-navigation.web'

/** A real leaf id: `parsePaneKey` refuses anything that is not one, so a made-up key parses to
 *  nothing and every case below would read as "the pane closed". */
const LEAF = '11111111-1111-4111-8111-111111111111'

const TABS: MobileSessionTab[] = [
  {
    type: 'terminal',
    id: 'first',
    parentTabId: 'tab-a',
    leafId: LEAF,
    title: 'first',
    terminal: 'pty-a',
    isActive: true
  },
  {
    type: 'terminal',
    id: 'second',
    parentTabId: 'tab-b',
    leafId: LEAF,
    title: 'second',
    terminal: 'pty-b',
    isActive: false
  }
]

const switched: MobileSessionTab[] = []

function Probe({ terminalsLoaded }: { terminalsLoaded: boolean }): null {
  useNotificationPaneNavigation({
    sessionTabs: TABS,
    terminalsLoaded,
    switchSessionTab: (tab) => switched.push(tab)
  })
  return null
}

function render(terminalsLoaded: boolean): ReactTestRenderer {
  const rendered: { tree: ReactTestRenderer | null } = { tree: null }
  act(() => {
    rendered.tree = create(createElement(Probe, { terminalsLoaded }))
  })
  if (rendered.tree === null) {
    throw new Error('the probe did not render')
  }
  return rendered.tree
}

/** What the shell does: re-send `init`, which the client publishes as a route that moved. */
function deliver(paneKey: string): void {
  act(() => {
    for (const listener of bridge.listeners.slice()) {
      listener({ pathname: '/h/host-1/session/wt-1', params: { paneKey } })
    }
  })
}

beforeEach(() => {
  bridge.route = null
  bridge.listeners = []
  switched.length = 0
})

/**
 * The page's pane hook, which has no route to read and no param to write back.
 *
 * Its native sibling reads `paneKey` off the app's route and clears it with `setParams`; inside
 * the page the document is served at `/` with one history entry, so the request arrives as a
 * re-sent `init` instead (ruling 33.1) and the shell clears the native param once this page has
 * been handed one. The native file's test mounts the native file, and the bridge test stops at
 * the client, so this is the only cover this half has.
 */
describe('the page pane hook', () => {
  it('switches to the pane the page was opened on, which arrives in the first init', () => {
    bridge.route = { pathname: '/h/host-1/session/wt-1', params: { paneKey: `tab-b:${LEAF}` } }
    render(true)
    expect(switched.map((tab) => tab.id)).toEqual(['second'])
  })

  it('holds that request until the terminals have loaded, rather than dropping it', () => {
    bridge.route = { pathname: '/h/host-1/session/wt-1', params: { paneKey: `tab-b:${LEAF}` } }
    const tree = render(false)
    expect(switched).toEqual([])
    act(() => {
      tree.update(createElement(Probe, { terminalsLoaded: true }))
    })
    expect(switched.map((tab) => tab.id)).toEqual(['second'])
  })

  it('switches again for a repeat tap on the pane already showing', () => {
    // The counter is why: the route is the one this hook last acted on, so a listener that
    // compared values would read the second tap as nothing having changed.
    render(true)
    deliver(`tab-a:${LEAF}`)
    deliver(`tab-a:${LEAF}`)
    expect(switched.map((tab) => tab.id)).toEqual(['first', 'first'])
  })

  it('takes a different pane as its own request', () => {
    render(true)
    deliver(`tab-a:${LEAF}`)
    deliver(`tab-b:${LEAF}`)
    expect(switched.map((tab) => tab.id)).toEqual(['first', 'second'])
  })

  it('ignores the clear the shell posts after each delivery', () => {
    // Load-bearing rather than defensive: the shell clears the native param once the page has the
    // route, and that clear is itself a route that moved.
    render(true)
    deliver(`tab-a:${LEAF}`)
    deliver('')
    expect(switched.map((tab) => tab.id)).toEqual(['first'])
  })

  it('consumes a request for a pane that has since closed, so no later render serves it', () => {
    render(true)
    deliver(`gone:${LEAF}`)
    expect(switched).toEqual([])
    // A re-render with nothing new delivered must not go looking for it again.
    deliver('')
    expect(switched).toEqual([])
  })

  it('does nothing at all when the page was opened on no pane', () => {
    render(true)
    expect(switched).toEqual([])
  })
})
