import { useLocalSearchParams } from 'expo-router'
import { MobileSessionRouteScreen } from '../../../../src/session/MobileSessionRouteScreen'
import { firstParam } from '../../../../src/navigation/route-param-reader'
import {
  shellScreenRoute,
  shellScreenRouteKey
} from '../../../../src/mobile-web-shell/shell-screen-route'
import { MobileWebShellScreen } from '../../../../src/mobile-web-shell/MobileWebShellScreen'
import { useMobileWebShellEnabled } from '../../../../src/mobile-web-shell/use-mobile-web-shell-enabled'

/**
 * The session screen — terminal and chat — from the desktop's bundle or from this app.
 *
 * The review switch's shape, for its reasons: the native screen is `MobileSessionRouteScreen`
 * rather than the body of this file, because `useMobileSessionController` at this file's top level
 * would open the terminal, chat and tab subscriptions behind the page as well as in front of it.
 * As an element it is built and not mounted, and only `fallback` ever mounts it.
 *
 * Four query params rather than the review's four, and one of them is consumed by the screen: the
 * notification hook rewrites `paneKey` to empty the moment it has switched to the pane, so a tap
 * cannot be replayed by a later snapshot. That rewrite is `setParams` on the handoff, which inside
 * the page is the document's own router, so the param has to arrive in the page for it to happen.
 */
export default function MobileSessionScreen() {
  // Through `firstParam` on every param, as every switch does: expo-router answers a repeated query
  // key with an array, and a bare read puts `String(['a','b'])` into the template, where
  // `encodeURIComponent` makes it the single segment `a%2Cb` — which the bridge's segment rule
  // accepts, so the shell opens a page for a workspace nobody has.
  const params = useLocalSearchParams<{
    hostId?: string | string[]
    worktreeId?: string | string[]
    name?: string | string[]
    created?: string | string[]
    warning?: string | string[]
    paneKey?: string | string[]
  }>()
  const hostId = firstParam(params.hostId)
  const worktreeId = firstParam(params.worktreeId)
  const enabled = useMobileWebShellEnabled()
  const native = <MobileSessionRouteScreen />

  // Each omitted when empty, because the screen reads the difference: `created` is a one-shot flag
  // the create flow sets to `1`, `warning` is the host's own text, `name` is a label the screen
  // otherwise derives from the workspace, and `paneKey` empty is exactly what the notification hook
  // writes back to say the tap is spent.
  const routeParams = Object.fromEntries(
    (['name', 'created', 'warning', 'paneKey'] as const)
      .map((key) => [key, firstParam(params[key])] as const)
      .filter(([, value]) => value !== '')
  )
  const route =
    hostId && worktreeId
      ? shellScreenRoute({
          pathname: `/h/${encodeURIComponent(hostId)}/session/${encodeURIComponent(worktreeId)}`,
          ...(Object.keys(routeParams).length === 0 ? {} : { params: routeParams })
        })
      : null

  if (enabled !== true || !hostId || route === null) {
    return native
  }
  // Keyed on the route: a host captures the grants its session was opened with, so a screen reused
  // across a route change would keep authorising frames under the grants of the route the page has
  // left. The key is what makes the change a remount, which disposes that bridge in the commit.
  return (
    <MobileWebShellScreen
      key={shellScreenRouteKey(route)}
      hostId={hostId}
      route={route}
      fallback={native}
    />
  )
}
