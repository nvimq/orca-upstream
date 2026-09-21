import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { FakeRpcClient } from './bridge-host-test-fakes'
import type { MobileWebShellSessionState } from './mobile-web-shell-session-contract'

type ScreenDependencies = {
  retry: Mock
  reportShellFailure: Mock
  reportDocumentLoaded: Mock
  reportPageReady: Mock
  /** The profile read rejected, which is the one state that has no host to build against. */
  snapshotUnreadable: boolean
  storageRefreshes: number
  openUrl: Mock
  push: Mock
  back: Mock
  /** What the native stack answers: false is a page opened as the first screen on it. */
  canGoBack: boolean
  pathname: string
  pageRoutes: readonly string[]
  routeGrants: readonly string[]
  lifecycle: string[]
  /** Every render of the shell view, which is one per render of the screen above it. */
  viewRenders: number
  /** Every frame the shell posted to the page, raw. */
  posted: string[]
  /** Whether the view refuses what it is handed, which is a page the post never reached. */
  postFails: boolean
  /** Whether a post waits for the case to settle it, so a case can render while one is in flight. */
  holdPosts: boolean
  /** The settlers for posts the view has taken and not answered. */
  heldPosts: (() => void)[]
  /** The handle the view last attached, so a case can make the host lose and regain one. */
  handle: { postBridgeMessage: (json: string) => Promise<void> } | null
  state: MobileWebShellSessionState
  /** Null for every case but the bridge's: with no client the hook builds no host at all. */
  client: FakeRpcClient | null
}

const SNAPSHOT = vi.hoisted(() => ({
  host: { id: 'host-1', name: 'Host One', endpoint: 'ws://host-1', lastConnected: 3 }
}))

const DEFAULT_ROUTE_GRANTS = vi.hoisted((): readonly string[] => [
  'navigate',
  'storage',
  'externalLink',
  'native.clipboard.write'
])

const dependencies = vi.hoisted((): ScreenDependencies => {
  // Before the module under test is imported, so its `__DEV__` guard is on and the developer facts
  // are reachable at all — they are the one thing here that must never grow a secret.
  Object.assign(globalThis, { __DEV__: true })
  return {
    retry: vi.fn(),
    reportShellFailure: vi.fn(),
    reportDocumentLoaded: vi.fn(),
    reportPageReady: vi.fn(),
    snapshotUnreadable: false,
    storageRefreshes: 0,
    openUrl: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
    canGoBack: true,
    pathname: '/h/host-1',
    pageRoutes: ['/h/[hostId]'],
    routeGrants: DEFAULT_ROUTE_GRANTS,
    lifecycle: [],
    viewRenders: 0,
    posted: [],
    postFails: false,
    holdPosts: false,
    heldPosts: [],
    handle: null,
    state: { kind: 'checking' },
    client: null
  }
})

vi.mock('react-native', () => ({
  ActivityIndicator: 'ActivityIndicator',
  Linking: { openURL: dependencies.openUrl },
  Platform: { OS: 'ios' },
  Pressable: 'Pressable',
  StyleSheet: { create: (styles: unknown) => styles },
  Text: 'Text',
  View: 'View'
}))
// Reaching the real one imports the Expo runtime this test does not have. The screen only passes
// the handler through; what it does with a verb is `native-clipboard.test.ts`.
vi.mock('expo-clipboard', () => ({
  setStringAsync: () => Promise.resolve(true),
  getStringAsync: () => Promise.resolve('')
}))
// Same reason, and the screen only hands `playPageHaptic` over: which expo member each kind
// reaches is `page-haptics.test.ts`. `Platform.OS` above is pinned to `ios`, so the Android
// members are never evaluated and are not listed.
vi.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
  NotificationFeedbackType: { Error: 'error', Success: 'success' }
}))
vi.mock('expo-document-picker', () => ({ getDocumentAsync: () => Promise.resolve(null) }))
vi.mock('@orca/expo-two-way-audio', () => ({
  addExpoTwoWayAudioEventListener: () => ({ remove: () => {} }),
  initialize: () => Promise.resolve(true),
  requestMicrophonePermissionsAsync: () =>
    Promise.resolve({ granted: true, canAskAgain: true, status: 'granted', expires: 'never' }),
  tearDown: () => {},
  toggleRecording: () => true
}))
vi.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: () => Promise.resolve(),
  deactivateKeepAwake: () => Promise.resolve()
}))
vi.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: () => Promise.resolve({ canceled: true }),
  requestMediaLibraryPermissionsAsync: () => Promise.resolve({ granted: false })
}))
vi.mock('expo-file-system', () => ({
  File: class {
    readonly size = 0
    delete(): void {}
  },
  Paths: { cache: 'file:///cache' }
}))
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ bottom: 8, left: 0, right: 0, top: 44 })
}))
vi.mock('expo-router', () => ({
  router: { replace: vi.fn() },
  useRouter: () => ({
    push: dependencies.push,
    back: dependencies.back,
    canGoBack: () => dependencies.canGoBack
  }),
  // Read by the pop latch, which clears on the route this shell is mounted at changing.
  usePathname: () => dependencies.pathname
}))
// A component rather than a host string: the React key is what makes a retry a rebuilt WebView,
// and a mount/unmount log is the only thing that can tell a remount from a prop update.
vi.mock('../../modules/orca-mobile-web-shell/src', async () => {
  const React = await import('react')
  const loadState = await import('../../modules/orca-mobile-web-shell/src/load-state')
  return {
    OrcaMobileWebShellView: (props: {
      sessionId: string
      ref?: (handle: { postBridgeMessage: (json: string) => Promise<void> } | null) => void
    }) => {
      dependencies.viewRenders += 1
      React.useEffect(() => {
        dependencies.lifecycle.push(`mount:${props.sessionId}`)
        return () => {
          dependencies.lifecycle.push(`unmount:${props.sessionId}`)
        }
      }, [props.sessionId])
      // The handle the real view exposes, which nothing here used to attach: without it every
      // post rejected as a view that is gone, so no case could see a frame reach the page.
      const attach = props.ref
      React.useLayoutEffect(() => {
        const handle = {
          postBridgeMessage: (json: string) => {
            dependencies.posted.push(json)
            if (dependencies.postFails) {
              return Promise.reject(new Error('the view would not take it'))
            }
            return dependencies.holdPosts
              ? new Promise<void>((settle) => dependencies.heldPosts.push(() => settle()))
              : Promise.resolve()
          }
        }
        dependencies.handle = handle
        attach?.(handle)
        return () => {
          attach?.(null)
        }
      }, [attach])
      return React.createElement('ShellViewProbe', props)
    },
    parseMobileWebShellLoadState: loadState.parseMobileWebShellLoadState
  }
})
// The real bridge hook runs, so the props it owns are the ones the view is handed here; only the
// client lookup is stubbed, because reaching it imports the Expo runtime this test does not have.
vi.mock('../transport/client-context', () => ({
  useHostClient: () => ({ client: dependencies.client })
}))
// Reaching the real one imports the host store and expo-secure-store, whose module touches an Expo
// global this test does not have. What it answers is the screen's input, not its behaviour.
vi.mock('./use-page-host-snapshot', () => ({
  usePageHostSnapshot: () => ({
    // One object for the life of the file, as the real hook's `useState` gives. A fresh literal per
    // render changes the identity the host effect is keyed on, so the bridge host was being torn
    // down and rebuilt on every render of this screen — and every pending request settled with it.
    snapshot: SNAPSHOT,
    unreadable: dependencies.snapshotUnreadable,
    readStorage: () => ({ storage: {}, storageOversize: [] }),
    refreshStorage: () => {
      dependencies.storageRefreshes += 1
    },
    writeStorage: () => {}
  })
}))
vi.mock('./use-mobile-web-shell-session', () => ({
  useMobileWebShellSession: () => ({
    state: dependencies.state,
    pageRoutes: dependencies.pageRoutes,
    routeGrants: dependencies.routeGrants,
    retry: dependencies.retry,
    reportShellFailure: dependencies.reportShellFailure,
    reportDocumentLoaded: dependencies.reportDocumentLoaded,
    reportPageReady: dependencies.reportPageReady
  })
}))

import { clientFrame, createFakeRpcClient } from './bridge-host-test-fakes'
import { BRIDGE_FAULT_GRANT, BRIDGE_NAVIGATE_BACK_NOTIFY } from './bridge/bridge-envelope'
import { BRIDGE_ROUTE_UPDATE_ACCEPT } from './bridge/bridge-route-update'
import { MobileWebShellScreen } from './MobileWebShellScreen'

/** The caller's native screen, as a component so `findAllByType` can name it without a host string. */
function NativeFallback(): null {
  return null
}

const BUILD_ID = 'a1b2c3d4e5f6'.repeat(5) + 'abcd'
const DIRECTORY = '/var/mobile/Containers/Data/Caches/mobile-web/deadbeef/generations/a1b2'

async function render(state: MobileWebShellSessionState): Promise<ReactTestRenderer> {
  dependencies.state = state
  const rendered: { tree: ReactTestRenderer | null } = { tree: null }
  await act(async () => {
    rendered.tree = create(
      createElement(MobileWebShellScreen, {
        hostId: 'host-1',
        route: { pathname: '/h/host-1' },
        fallback: createElement(NativeFallback)
      })
    )
  })
  if (rendered.tree === null) {
    throw new Error('screen did not render')
  }
  mounted.push(rendered.tree)
  return rendered.tree
}

/** Unmounted between cases: the shell's stack latch is one per stack, so a screen left mounted is
 *  a screen still holding whatever pop it took. */
const mounted: ReactTestRenderer[] = []

function unmountRenderedScreens(): void {
  act(() => {
    for (const tree of mounted.splice(0)) {
      tree.unmount()
    }
  })
}

function readyState(sessionId: string): MobileWebShellSessionState {
  return {
    kind: 'ready',
    generationDirectory: DIRECTORY,
    sessionId,
    buildId: BUILD_ID,
    totalBytes: 4096,
    elapsedMs: 811
  }
}

async function update(tree: ReactTestRenderer, state: MobileWebShellSessionState): Promise<void> {
  dependencies.state = state
  await act(async () => {
    tree.update(
      createElement(MobileWebShellScreen, {
        hostId: 'host-1',
        route: { pathname: '/h/host-1' },
        fallback: createElement(NativeFallback)
      })
    )
  })
}

/** Host elements are matched by name, not by `findAllByType`: React's `ElementType` does not admit
 *  an arbitrary React Native host name, so the typed form is a predicate. */
function byName(tree: ReactTestRenderer, name: string): ReactTestInstance[] {
  return tree.root.findAll((node) => String(node.type) === name)
}

function textOf(tree: ReactTestRenderer): string {
  return byName(tree, 'Text')
    .map((node) => node.children.filter((child) => typeof child === 'string').join(''))
    .join('\n')
}

afterEach(unmountRenderedScreens)

/**
 * File-level, not per describe: every block here shares one mutable `dependencies`, so a reset
 * scoped to one of them leaves whatever the others set. `routeGrants` is reset for that reason —
 * a case that grants the screencast lane would otherwise hand it to every case that follows.
 */
beforeEach(() => {
  dependencies.retry.mockReset()
  dependencies.reportShellFailure.mockReset()
  dependencies.reportDocumentLoaded.mockReset()
  dependencies.reportPageReady.mockReset()
  dependencies.snapshotUnreadable = false
  dependencies.storageRefreshes = 0
  dependencies.lifecycle.length = 0
  dependencies.viewRenders = 0
  dependencies.posted.length = 0
  dependencies.postFails = false
  dependencies.holdPosts = false
  dependencies.heldPosts.length = 0
  dependencies.handle = null
  dependencies.client = null
  dependencies.routeGrants = DEFAULT_ROUTE_GRANTS
  dependencies.back.mockReset()
  dependencies.openUrl.mockReset()
  dependencies.openUrl.mockImplementation(() => Promise.resolve(true))
  dependencies.canGoBack = true
  dependencies.pathname = '/h/host-1'
})

describe('the hybrid shell screen', () => {
  it('renders the update wall for a bundle verdict, with no shell view', async () => {
    const tree = await render({
      kind: 'wall',
      verdict: { kind: 'blocked', reason: 'bundle-unavailable' }
    })
    expect(textOf(tree)).toContain('Update Orca on your computer')
    expect(byName(tree, 'ShellViewProbe')).toEqual([])
  })

  it('renders the refetch wall a cached generation older than the host earns', async () => {
    const tree = await render({
      kind: 'wall',
      verdict: {
        kind: 'blocked',
        reason: 'bundle-incompatible',
        side: 'mobile',
        bundleRuntimeProtocolVersion: 3,
        requiredBundleRuntimeProtocolVersion: 9
      }
    })
    expect(textOf(tree)).toContain('Refresh the mobile workspace')
  })

  it('offers Try again on a failure a retry can clear', async () => {
    const tree = await render({
      kind: 'failed',
      reason: 'document-load-failed',
      retriedOnce: true
    })
    expect(textOf(tree)).toContain('The downloaded workspace could not be opened.')
    const retry = tree.root.findAll((node) => node.props.testID === 'mobile-web-shell-retry')
    expect(retry).toHaveLength(1)
    await act(async () => {
      retry[0].props.onPress()
    })
    expect(dependencies.retry).toHaveBeenCalledTimes(1)
  })

  it('offers no retry when the device cannot isolate a WebView', async () => {
    const tree = await render({
      kind: 'failed',
      reason: 'isolation-unavailable',
      retriedOnce: false
    })
    expect(textOf(tree)).toContain("This device's WebView is too old")
    expect(tree.root.findAll((node) => node.props.testID === 'mobile-web-shell-retry')).toEqual([])
  })

  it('offers no retry for a status that could not be read, since the gate is settled', async () => {
    const tree = await render({
      kind: 'failed',
      reason: 'status-unreadable',
      retriedOnce: false
    })
    expect(textOf(tree)).toContain("Could not read this host's status")
    expect(tree.root.findAll((node) => node.props.testID === 'mobile-web-shell-retry')).toEqual([])
  })

  it('names what is missing when the host is unreachable and nothing is cached', async () => {
    expect(textOf(await render({ kind: 'offline' }))).toContain(
      'Connect to this host to download the workspace'
    )
  })

  it('counts assets and bytes while downloading', async () => {
    const tree = await render({
      kind: 'fetching',
      completedAssets: 2,
      totalAssets: 4,
      receivedBytes: 2048,
      totalBytes: 4096
    })
    expect(textOf(tree)).toContain('2/4 files')
    expect(textOf(tree)).toContain('2048/4096 bytes')
  })

  it('hands the shell view the generation path and the session id', async () => {
    const tree = await render(readyState('session-one'))
    const view = byName(tree, 'ShellViewProbe')[0]
    expect(view.props.generationDirectory).toBe(DIRECTORY)
    expect(view.props.sessionId).toBe('session-one')
  })

  it('opens the bridge channel on a ready session and hands it a receiver', async () => {
    const tree = await render(readyState('session-one'))
    const view = byName(tree, 'ShellViewProbe')[0]
    expect(view.props.bridgeEnabled).toBe(true)
    expect(typeof view.props.onBridgeMessage).toBe('function')
    // Delivered with no client behind it: there is no host to answer, and nothing throws.
    await act(async () => {
      view.props.onBridgeMessage({ nativeEvent: { json: '{"v":1,"type":"ready"}' } })
    })
  })

  it('rebuilds the view rather than updating it when the session id changes', async () => {
    const tree = await render(readyState('session-one'))
    await update(tree, readyState('session-two'))
    expect(dependencies.lifecycle).toEqual([
      'mount:session-one',
      'unmount:session-one',
      'mount:session-two'
    ])
  })

  it('forwards a failure the native view reports and drops a payload it cannot read', async () => {
    const tree = await render(readyState('session-one'))
    const view = byName(tree, 'ShellViewProbe')[0]
    await act(async () => {
      view.props.onLoadState({ nativeEvent: { state: 'ready' } })
      view.props.onLoadState({ nativeEvent: { state: 'failed', reason: 'invented' } })
      view.props.onLoadState({ nativeEvent: { state: 'failed', reason: 'render-process-gone' } })
    })
    expect(dependencies.reportShellFailure.mock.calls).toEqual([['render-process-gone']])
  })

  it('starts the wait for the page when the native view says the document finished', async () => {
    const tree = await render(readyState('session-one'))
    const view = byName(tree, 'ShellViewProbe')[0]
    await act(async () => {
      view.props.onLoadState({ nativeEvent: { state: 'loading' } })
      view.props.onLoadState({ nativeEvent: { state: 'ready' } })
      view.props.onLoadState({ nativeEvent: { state: 'failed', reason: 'document-load-failed' } })
    })
    // Once, for the one finished document, and never for the failure: a view that reported a
    // failure has nothing left to wait for.
    expect(dependencies.reportDocumentLoaded).toHaveBeenCalledTimes(1)
  })

  it('fails the session when this host could not be read from the app store', async () => {
    // Without this the session stays `ready` with the view un-hidden, no host behind it, and the
    // page re-posting `ready` on its backoff for as long as the screen is open.
    dependencies.snapshotUnreadable = true
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    await render(readyState('session-one'))
    expect(dependencies.reportShellFailure.mock.calls).toEqual([['document-load-failed']])
    warned.mockRestore()
  })

  it('re-reads the app store on every ask, so the next init is not the first one again', async () => {
    dependencies.client = createFakeRpcClient()
    const tree = await render(readyState('session-one'))
    const view = byName(tree, 'ShellViewProbe')[0]
    await act(async () => {
      view.props.onBridgeMessage({ nativeEvent: { json: clientFrame({ type: 'ready' }) } })
      view.props.onBridgeMessage({ nativeEvent: { json: clientFrame({ type: 'ready' }) } })
    })
    // A document that reloads inside one mount asks again; a refresh per ask is what lets a key
    // the app changed meanwhile reach the `init` after it.
    expect(dependencies.storageRefreshes).toBe(2)
  })

  /**
   * One screen whose route this case moves, and everything the page was told about it.
   *
   * The delivery family renders the same way every time — a fresh element per route so the prop
   * identity moves, the delivery callback collecting what landed, a `ready` declaring the accept
   * the second `init` needs — and a case that spells all of that out reads as setup rather than as
   * the fact it pins.
   */
  async function renderForDelivery(params: Record<string, string>): Promise<{
    tree: ReactTestRenderer
    delivered: { pathname: string; params?: Record<string, string> }[]
    paneKeys: () => string[]
    move: (next: Record<string, string>) => Promise<void>
    ready: (accepts?: readonly string[]) => Promise<void>
  }> {
    const delivered: { pathname: string; params?: Record<string, string> }[] = []
    const element = (next: Record<string, string>) =>
      createElement(MobileWebShellScreen, {
        hostId: 'host-1',
        route: { pathname: '/h/host-1', params: next },
        fallback: createElement(NativeFallback),
        onRouteDelivered: (route) => delivered.push(route)
      })
    dependencies.state = readyState('session-one')
    const rendered: { tree: ReactTestRenderer | null } = { tree: null }
    await act(async () => {
      rendered.tree = create(element(params))
    })
    const tree = rendered.tree
    if (tree === null) {
      throw new Error('screen did not render')
    }
    mounted.push(tree)
    return {
      tree,
      delivered,
      paneKeys: () => delivered.map((route) => route.params?.paneKey ?? ''),
      move: async (next) => {
        await act(async () => {
          tree.update(element(next))
        })
      },
      ready: async (accepts = [BRIDGE_ROUTE_UPDATE_ACCEPT]) => {
        await act(async () => {
          byName(tree, 'ShellViewProbe')[0]?.props.onBridgeMessage({
            nativeEvent: { json: clientFrame({ type: 'ready', accepts }) }
          })
        })
      }
    }
  }

  /**
   * A route that moved before the host existed (CodeRabbit on `:271`).
   *
   * The effect recorded the route's key and then published, so a publish the hook refused for
   * having no host counted as delivered anyway. This pins the delivery contract across that gap:
   * the caller is told once, and only when a frame carrying the route actually reached the page.
   *
   * It does not reproduce a lost tap, and the fix beside it is hygiene rather than a repair: the
   * host is built from the route the render holds, so a route that moved before it existed is in
   * the first `init` regardless, and `publishRoute` then answers "did not move". What the fix
   * removes is a key recorded for a frame nobody sent.
   */
  it('reports a route that moved before the host existed once, when the page receives it', async () => {
    dependencies.client = null
    const page = await renderForDelivery({ paneKey: '' })
    // The tap, with no host to take it: nothing reached the page, so nothing is reported.
    await page.move({ paneKey: 'pane-1' })
    expect(page.delivered).toEqual([])
    dependencies.client = createFakeRpcClient()
    await page.move({ paneKey: 'pane-1' })
    // Still nothing: the host now holds that route and has not sent anything yet.
    expect(page.delivered).toEqual([])
    await page.ready([])
    // The `init` that answered the ask carried it, so the caller may spend the param — once.
    expect(page.delivered).toEqual([{ pathname: '/h/host-1', params: { paneKey: 'pane-1' } }])
  })

  /**
   * A frame the view would not take (CodeRabbit on `bridge-host.ts:104-126`).
   *
   * `sendInit` answered "sent" the moment it handed the JSON to `post`, and the post's rejection
   * was reported a turn later as a diagnostic. So the screen spent the one-shot `paneKey` on a
   * frame the page never received: the switch cleared the native param and the tap was gone.
   */
  it('reports no delivery for an init the view refused, so the param is not spent', async () => {
    dependencies.client = createFakeRpcClient()
    dependencies.postFails = true
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const page = await renderForDelivery({ paneKey: 'pane-1' })
    await page.ready([])
    // The frame was built and handed over, and the view refused it.
    expect(dependencies.posted).toHaveLength(1)
    expect(page.delivered).toEqual([])
    // The page still asked, which is a different fact from the frame landing.
    expect(dependencies.reportPageReady).toHaveBeenCalled()
    warned.mockRestore()
  })

  /**
   * A route whose frame the view refused is still owed to the page (round 4).
   *
   * The screen used to own the attempt: it recorded the route it had tried and cleared that record
   * on a refusal, so the only thing that could try again was another render. A view that comes
   * back — the native handle re-attaching under the same mounted page — is not one, so the pane
   * the user asked for stayed on the shell's side forever. The host owns it now: the route stays
   * pending until a post resolves true, and a regained handle is one of the moments it retries.
   */
  it('delivers a pending route when the host regains a view handle', async () => {
    dependencies.client = createFakeRpcClient()
    dependencies.postFails = true
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const page = await renderForDelivery({ paneKey: 'pane-1' })
    await page.ready()
    expect(page.delivered).toEqual([])
    // The same page, a handle it may be posted on again.
    dependencies.postFails = false
    const probe = byName(page.tree, 'ShellViewProbe')[0]
    await act(async () => {
      probe?.props.ref(null)
      probe?.props.ref(dependencies.handle)
    })
    expect(page.delivered).toEqual([{ pathname: '/h/host-1', params: { paneKey: 'pane-1' } }])
    warned.mockRestore()
  })

  /**
   * A render between the frame and its answer does not cancel the delivery (round 4).
   *
   * The screen's effect cancelled its own pending answer on cleanup, so any render while a post
   * was in flight — a state change anywhere above, which is routine — dropped the report the
   * switch spends to clear the param. The page had the route and the shell never heard.
   */
  it('delivers once when the screen re-renders while the frame is in flight', async () => {
    dependencies.client = createFakeRpcClient()
    const page = await renderForDelivery({ paneKey: '' })
    await page.ready()
    expect(page.delivered).toHaveLength(1)
    dependencies.holdPosts = true
    await page.move({ paneKey: 'pane-1' })
    expect(dependencies.heldPosts).toHaveLength(1)
    await page.move({ paneKey: 'pane-1' })
    // The route did not move, so the render in flight costs no second frame.
    expect(dependencies.heldPosts).toHaveLength(1)
    await act(async () => {
      dependencies.heldPosts[0]?.()
    })
    expect(page.paneKeys()).toEqual(['', 'pane-1'])
  })

  /**
   * A pane asked for while the frame for the one before it is still in flight (round 5).
   *
   * One frame at a time is right — a second copy of `init` on the wire for a route already being
   * sent is waste — but the held route that was refused a turn had nothing to wake it: the post
   * settling only cleared the flag. So the newer pane sat until a `ready`, a handle or another
   * tap happened along, and on a mounted page none of those is coming. A landing is now itself a
   * moment to publish again, while what the host holds is not what the page has.
   */
  it('delivers a pane asked for during the frame before it, in order', async () => {
    dependencies.client = createFakeRpcClient()
    const page = await renderForDelivery({ paneKey: '' })
    await page.ready()
    dependencies.holdPosts = true
    await page.move({ paneKey: 'pane-1' })
    await page.move({ paneKey: 'pane-2' })
    // Still one frame: the second pane is held, not sent alongside the first.
    expect(dependencies.heldPosts).toHaveLength(1)
    await act(async () => {
      dependencies.heldPosts[0]?.()
    })
    // The landing is what publishes the one behind it.
    expect(dependencies.heldPosts).toHaveLength(2)
    await act(async () => {
      dependencies.heldPosts[1]?.()
    })
    expect(page.paneKeys()).toEqual(['', 'pane-1', 'pane-2'])
    expect(dependencies.lifecycle.filter((entry) => entry.startsWith('mount:'))).toHaveLength(1)
  })

  /**
   * The same pane, asked for twice, after the first frame was refused (round 4).
   *
   * The host moved its held route on the refused attempt, so the second tap read as a route that
   * had not moved and was held rather than sent: the page never got the pane and the param was
   * never spent. Movement is measured against what the page received, so the repeat tap lands.
   */
  it('delivers a repeat tap for the pane whose frame never landed', async () => {
    dependencies.client = createFakeRpcClient()
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const page = await renderForDelivery({ paneKey: '' })
    await page.ready()
    expect(page.delivered).toHaveLength(1)
    dependencies.postFails = true
    await page.move({ paneKey: 'pane-1' })
    expect(page.delivered).toHaveLength(1)
    // The tap was never spent, so the next one carries the same pane.
    dependencies.postFails = false
    await page.move({ paneKey: 'pane-1' })
    expect(page.paneKeys()).toEqual(['', 'pane-1'])
    warned.mockRestore()
  })

  it('ends that wait on the page asking for a session', async () => {
    dependencies.client = createFakeRpcClient()
    const tree = await render(readyState('session-one'))
    await act(async () => {
      byName(tree, 'ShellViewProbe')[0].props.onBridgeMessage({
        nativeEvent: { json: clientFrame({ type: 'ready' }) }
      })
    })
    expect(dependencies.reportPageReady).toHaveBeenCalled()
  })

  it('fails the session on a page fault, so a blank page becomes the failure screen', async () => {
    dependencies.client = createFakeRpcClient()
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const tree = await render(readyState('session-one'))
    await act(async () => {
      // The page asks for its session first, which is what earns it the `fault` grant: a host that
      // has told a page nothing refuses the name.
      byName(tree, 'ShellViewProbe')[0].props.onBridgeMessage({
        nativeEvent: { json: clientFrame({ type: 'ready' }) }
      })
      byName(tree, 'ShellViewProbe')[0].props.onBridgeMessage({
        nativeEvent: {
          json: clientFrame({
            type: 'notify',
            name: BRIDGE_FAULT_GRANT,
            error: { category: 'Error', message: 'the route threw', isRpcDeliveryUnknown: false }
          })
        }
      })
    })
    expect(dependencies.reportShellFailure.mock.calls).toEqual([['document-load-failed']])
    warned.mockRestore()
    // The reducer's answer to that reason, rendered: this is what the page's blank turns into.
    expect(
      textOf(await render({ kind: 'failed', reason: 'document-load-failed', retriedOnce: true }))
    ).toContain('The downloaded workspace could not be opened.')
  })

  it('reports a URL nothing on this phone could open, which is the dead tap that survives', async () => {
    dependencies.client = createFakeRpcClient()
    const failure = new Error('no activity found')
    // A fresh rejection per call, not one built here: `mockReturnValue(Promise.reject(...))` builds
    // it now and nothing attaches a handler until the frame arrives, which is an unhandled
    // rejection in the window between.
    dependencies.openUrl.mockImplementation(() => Promise.reject(failure))
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const tree = await render(readyState('session-one'))
    await act(async () => {
      byName(tree, 'ShellViewProbe')[0].props.onBridgeMessage({
        nativeEvent: { json: clientFrame({ type: 'ready' }) }
      })
      byName(tree, 'ShellViewProbe')[0].props.onBridgeMessage({
        nativeEvent: {
          json: clientFrame({
            type: 'notify',
            name: 'externalLink',
            url: 'mailto:someone@example.com'
          })
        }
      })
    })
    // Nothing crosses back for a notify, so silence here is the one dead tap this verb does not
    // rule out: the page was told the frame left and the phone opened nothing.
    expect(warned.mock.calls).toContainEqual([
      '[web-shell] could not open a URL for the page',
      { url: 'mailto:someone@example.com', error: failure }
    ])
    warned.mockRestore()
  })

  it('pops its own stack when the page hands its back button over', async () => {
    dependencies.client = createFakeRpcClient()
    const tree = await render(readyState('session-one'))
    await act(async () => {
      byName(tree, 'ShellViewProbe')[0].props.onBridgeMessage({
        nativeEvent: { json: clientFrame({ type: 'ready' }) }
      })
      byName(tree, 'ShellViewProbe')[0].props.onBridgeMessage({
        nativeEvent: { json: clientFrame({ type: 'notify', name: BRIDGE_NAVIGATE_BACK_NOTIFY }) }
      })
    })
    expect(dependencies.back).toHaveBeenCalledTimes(1)
    expect(dependencies.push).not.toHaveBeenCalled()
  })

  it('pops nothing when this page is the first screen on the stack, rather than dismissing it', async () => {
    dependencies.client = createFakeRpcClient()
    dependencies.canGoBack = false
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const tree = await render(readyState('session-one'))
    await act(async () => {
      byName(tree, 'ShellViewProbe')[0].props.onBridgeMessage({
        nativeEvent: { json: clientFrame({ type: 'ready' }) }
      })
      byName(tree, 'ShellViewProbe')[0].props.onBridgeMessage({
        nativeEvent: { json: clientFrame({ type: 'notify', name: BRIDGE_NAVIGATE_BACK_NOTIFY }) }
      })
    })
    expect(dependencies.back).not.toHaveBeenCalled()
    // The page is told nothing either way, so the log is the only thing a dead Back button leaves.
    expect(warned.mock.calls).toContainEqual([
      '[web-shell-bridge] did not pop the stack for a page going back',
      { why: 'nothing-to-pop' }
    ])
    warned.mockRestore()
  })

  it('shows a build id prefix and never the whole one, the cache path, or the host id', async () => {
    const tree = await render(readyState('session-one'))
    const text = textOf(tree)
    expect(text).toContain(BUILD_ID.slice(0, 12))
    expect(text).toContain('4096 B')
    expect(text).toContain('811 ms')
    expect(text).not.toContain(BUILD_ID)
    expect(text).not.toContain(DIRECTORY)
    expect(text).not.toContain('host-1')
  })
})

describe('the route the shell was not asked to render', () => {
  it('hands the screen back to the caller rather than painting anything of its own', async () => {
    const tree = await render({ kind: 'native-route' })
    expect(tree.root.findAllByType(NativeFallback)).toHaveLength(1)
    expect(byName(tree, 'ShellViewProbe')).toEqual([])
    expect(byName(tree, 'ActivityIndicator')).toEqual([])
  })
})

describe('the dropped-frame count on the dev facts line', () => {
  /** 500,000 bytes encodes past the frame cap, so every one of these is dropped. */
  const oversized = {
    opcode: 1 as const,
    seq: 1,
    format: 'jpeg' as const,
    metadata: {},
    image: new Uint8Array(500_000)
  }

  async function openBinaryStream(tree: ReactTestRenderer): Promise<void> {
    await act(async () => {
      byName(tree, 'ShellViewProbe')[0]?.props.onBridgeMessage({
        nativeEvent: { json: clientFrame({ type: 'ready' }) }
      })
    })
    await act(async () => {
      byName(tree, 'ShellViewProbe')[0]?.props.onBridgeMessage({
        nativeEvent: {
          json: clientFrame({
            type: 'subscribe',
            id: 'a'.repeat(22),
            method: 'browser.screencast',
            params: {},
            wantsBinary: true
          })
        }
      })
    })
  }

  async function drop(times: number): Promise<void> {
    for (let index = 0; index < times; index += 1) {
      await act(async () => {
        dependencies.client?.streams[0]?.emitBinary?.({ ...oversized, seq: index + 1 })
      })
    }
  }

  function devFactsText(tree: ReactTestRenderer): string | null {
    const line = byName(tree, 'Text').find(
      (node) => node.props.testID === 'mobile-web-shell-dev-facts'
    )
    return line === undefined ? null : String(line.props.children)
  }

  it('shows the running total and resets it when the host is rebuilt', async () => {
    dependencies.client = createFakeRpcClient()
    dependencies.routeGrants = ['navigate', 'screencastBinary']
    const tree = await render(readyState('session-one'))
    await openBinaryStream(tree)
    await drop(2)
    expect(devFactsText(tree)).toContain('2 frames dropped')
    await update(tree, readyState('session-two'))
    expect(devFactsText(tree)).not.toContain('dropped')
  })

  /**
   * The line renders null outside a development build, so state behind it is a re-render of the
   * whole screen for a fact nobody can see — at up to ten a second on a page the desktop cannot
   * compress. Counted rather than reasoned about.
   */
  it('renders the screen not once more per dropped frame in a production build', async () => {
    Object.assign(globalThis, { __DEV__: false })
    try {
      dependencies.client = createFakeRpcClient()
      dependencies.routeGrants = ['navigate', 'screencastBinary']
      const tree = await render(readyState('session-one'))
      await openBinaryStream(tree)
      expect(devFactsText(tree)).toBeNull()
      const before = dependencies.viewRenders
      await drop(5)
      expect({ extraRenders: dependencies.viewRenders - before }).toEqual({ extraRenders: 0 })
      expect(devFactsText(tree)).toBeNull()
    } finally {
      Object.assign(globalThis, { __DEV__: true })
    }
  })
})

/**
 * Last in the file on purpose: it is the case the block above would have poisoned.
 *
 * Those cases grant the screencast lane and install a client, and before the shared setup reset
 * them both, whatever ran next inherited a route granted a lane it never asked for. Deleting the
 * reset fails here and nowhere else, because nothing else runs after a case that mutates them.
 */
describe('what one case mutates does not reach the next', () => {
  it('starts from the shared route grants and no client', () => {
    expect({ grants: dependencies.routeGrants, client: dependencies.client }).toEqual({
      grants: DEFAULT_ROUTE_GRANTS,
      client: null
    })
  })
})
