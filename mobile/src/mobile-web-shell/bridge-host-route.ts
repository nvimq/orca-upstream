import {
  BridgeInitRouteSchema,
  type BridgeClientMessage,
  type BridgeInitRoute
} from './bridge/bridge-envelope'
import { bridgeRouteMoved, readBridgeRouteUpdate } from './bridge/bridge-route-update'

/** The screen one host is serving, which is the one field of `init` that moves under a live page. */
export type BridgeHostRoute = {
  /** Null when this shell named a screen the protocol does not allow; no session is served then. */
  readonly current: () => BridgeInitRoute | null
  /** Why the opened route was refused, for the line the host prints at construction. */
  readonly openIssue: () => string
  /** What the page's latest `ready` said it can be sent. Reset by each document's `ready`. */
  readonly readReady: (message: Extract<BridgeClientMessage, { type: 'ready' }>) => void
  /**
   * Hands the page a rewritten param for the screen it is already on. The held route moves either
   * way, so a page that reloads inside this mount is given the newest one on its next `ready` even
   * when it is too old to be sent one in flight. Delivery is reported by `onDelivered`, not here:
   * the frame may still be in flight when this returns, and whoever spends the param is not
   * whoever asked for it.
   */
  readonly publish: (next: BridgeInitRoute, deliverable: boolean) => void
  /**
   * Re-attempts the route the page has not received. Called on the moments a stranded frame gets
   * another chance: a new `ready`, and a view handle the host has just regained.
   */
  readonly retry: (deliverable: boolean) => void
  /** Records that a frame carrying `sent` reached the page, which is what reports delivery. */
  readonly landed: (sent: BridgeInitRoute) => void
}

/**
 * One host's route: what the shell asked for, and what a frame has actually reached the page
 * with. The two differ while a delivery is owed, which is the whole point of this module owning
 * them — a post that the view refused leaves the route pending here rather than stranding it in a
 * caller's effect, so the next `ready`, the next handle and the next tap all carry it.
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
  sendInit: () => Promise<boolean>
  onRefused: (issue: string) => void
  /** The page received this route. Fired once per route, from whichever frame carried it. */
  onDelivered: (route: BridgeInitRoute) => void
}): BridgeHostRoute {
  const parsed = BridgeInitRouteSchema.safeParse(args.opened)
  let route = parsed.success && !args.refused ? parsed.data : null
  let accepts: readonly string[] = []
  /** What a frame has reached the page with. Null until one lands, so the first `init` delivers. */
  let delivered: BridgeInitRoute | null = null
  /** One frame at a time: a render during a post must not put a second copy of it on the wire. */
  let inFlight = false

  function attempt(next: BridgeInitRoute, deliverable: boolean): void {
    const update = readBridgeRouteUpdate({ held: route, delivered, next, accepts, deliverable })
    if (update.kind === 'refuse') {
      args.onRefused(update.issue)
      return
    }
    route = update.route
    if (update.kind === 'hold' || inFlight) {
      return
    }
    inFlight = true
    void args.sendInit().then(
      (landed) => {
        inFlight = false
        // A landing is itself a moment to publish: a route that moved while this frame was out was
        // held for the turn, and on a mounted page no `ready`, handle or tap need ever come along
        // to wake it. Only on a landing, because a refused post that re-attempted itself would
        // spin — that one waits for whatever made delivery possible again.
        if (landed && route !== null) {
          attempt(route, deliverable)
        }
      },
      () => {
        inFlight = false
      }
    )
  }

  return {
    current: () => route,
    openIssue: () => (parsed.success ? 'unknown' : (parsed.error.issues[0]?.message ?? 'unknown')),
    readReady: (message) => {
      accepts = message.accepts ?? []
    },
    publish: (next, deliverable) => {
      attempt(next, deliverable)
    },
    retry: (deliverable) => {
      if (route !== null) {
        attempt(route, deliverable)
      }
    },
    landed: (sent) => {
      if (!bridgeRouteMoved(delivered, sent)) {
        return
      }
      delivered = sent
      args.onDelivered(sent)
    }
  }
}
