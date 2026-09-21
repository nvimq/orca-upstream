import { BridgeInitRouteSchema, type BridgeInitRoute } from './bridge-envelope'
import { shellScreenRouteKey } from '../shell-screen-route'

/**
 * The one thing a page can say it accepts, which is a second `init` for the session it already has.
 *
 * A notification tap for another pane of the session on screen rewrites one route param of a page
 * that is already mounted, and the shell has no push lane to deliver it on: `notify` runs
 * page-to-shell only, and a shell-to-page frame kind would need a capability of its own
 * (`bridge-audio-verbs.ts` refused one for raw PCM). `init` already carries `route`, is already
 * re-sent on every `ready` and is already re-read, so the pane request rides it.
 *
 * Declared by the page rather than assumed by the shell, in both directions. A page too old to
 * name it reads a second `init` as a replacement and settles every request it holds, so a shell
 * that sent one unasked would break it; a shell too old to re-send one leaves a newer page exactly
 * where it is today. Both degrade to the repeat tap doing nothing, which is what it does now.
 */
export const BRIDGE_ROUTE_UPDATE_ACCEPT = 'route-update'

/**
 * What a host does with a rewritten route: hold it for the next `init`, send one now, or refuse.
 *
 * `hold` and `send` both move what the host will publish, because a page that reloads inside this
 * mount must be handed the newest route on its next `ready` even when it is too old to be sent one
 * in flight. Only `send` is a frame, and only a frame lets the caller clear the param it delivered.
 */
export type BridgeRouteUpdate =
  | { readonly kind: 'send'; readonly route: BridgeInitRoute }
  | { readonly kind: 'hold'; readonly route: BridgeInitRoute }
  | { readonly kind: 'refuse'; readonly issue: string }

/**
 * Whether this host may hand its page that route, decided from the route it is already serving.
 *
 * A different pathname is a different screen, which the shell remounts for; the schema is the
 * page's own reader, so a shape it would refuse never leaves. Movement is measured with
 * `shellScreenRouteKey` rather than a second spelling of it, so "moved" here means exactly what a
 * remount means at the switch.
 */
export function readBridgeRouteUpdate(args: {
  held: BridgeInitRoute | null
  next: BridgeInitRoute
  /** What the page's last `ready` declared. Empty for every page built before this existed. */
  accepts: readonly string[]
  /** Whether this host has a served document that has already had an `init`. */
  deliverable: boolean
}): BridgeRouteUpdate {
  const { held } = args
  const parsed = BridgeInitRouteSchema.safeParse(args.next)
  if (held === null || !parsed.success) {
    return { kind: 'refuse', issue: held === null ? 'no-route' : 'unreadable-route' }
  }
  if (parsed.data.pathname !== held.pathname) {
    return { kind: 'refuse', issue: 'not-this-screen' }
  }
  const moved = shellScreenRouteKey(parsed.data) !== shellScreenRouteKey(held)
  const sendable = moved && args.deliverable && args.accepts.includes(BRIDGE_ROUTE_UPDATE_ACCEPT)
  return { kind: sendable ? 'send' : 'hold', route: parsed.data }
}
