import {
  BridgeInitRouteSchema,
  type BridgeClientMessage,
  type BridgeInitRoute
} from './bridge/bridge-envelope'
import { readBridgeRouteUpdate } from './bridge/bridge-route-update'

/** The screen one host is serving, which is the one field of `init` that moves under a live page. */
export type BridgeHostRoute = {
  /** Null when this shell named a screen the protocol does not allow; no session is served then. */
  readonly current: () => BridgeInitRoute | null
  /** Why the opened route was refused, for the line the host prints at construction. */
  readonly openIssue: () => string
  /** What the page's latest `ready` said it can be sent. Reset by each document's `ready`. */
  readonly readReady: (message: Extract<BridgeClientMessage, { type: 'ready' }>) => void
  /**
   * Hands the page a rewritten param for the screen it is already on, and answers whether a frame
   * went out. The held route moves either way, so a page that reloads inside this mount is given
   * the newest one on its next `ready` even when it is too old to be sent one in flight.
   */
  readonly publish: (next: BridgeInitRoute, deliverable: boolean) => boolean
}

/**
 * One host's route, parsed once and reassigned only by `publish`.
 *
 * Parsed here against the same schema the page reads it with, rather than trusted. The producer
 * interpolates a host id into a pathname, so a host id carrying `?`, `#`, whitespace or a dot
 * segment reaches the wire as a route no page will accept; without this the page refuses the whole
 * `init`, asks again on its backoff forever, and the shell un-hides a WebView that will never
 * paint.
 *
 * Its own module because the route stopped being a constant (ruling 33.1): a notification tap for
 * another pane of the session on screen rewrites one param of a page that is already mounted, and
 * what the host may do about that is a decision with four inputs rather than a field.
 */
export function createBridgeHostRoute(args: {
  /** What the shell asked for, unparsed. */
  opened: BridgeInitRoute
  /** True when the pair beside the route was itself refused; then no session is served either. */
  refused: boolean
  sendInit: () => void
  onRefused: (issue: string) => void
}): BridgeHostRoute {
  const parsed = BridgeInitRouteSchema.safeParse(args.opened)
  let route = parsed.success && !args.refused ? parsed.data : null
  let accepts: readonly string[] = []
  return {
    current: () => route,
    openIssue: () => (parsed.success ? 'unknown' : (parsed.error.issues[0]?.message ?? 'unknown')),
    readReady: (message) => {
      accepts = message.accepts ?? []
    },
    publish: (next, deliverable) => {
      const update = readBridgeRouteUpdate({ held: route, next, accepts, deliverable })
      if (update.kind === 'refuse') {
        args.onRefused(update.issue)
        return false
      }
      route = update.route
      if (update.kind === 'hold') {
        return false
      }
      args.sendInit()
      return true
    }
  }
}
