import { useEffect, useRef, useState } from 'react'
import { usePageBridgeClient } from '../transport/client-context.web'
import type { MobileSessionTab } from './mobile-session-route-types'
import { notificationPaneTab } from './notification-pane-tab'

/**
 * Web sibling: the pane a notification tap asked for, read off the shell rather than off a router.
 *
 * On the page there is no native route to read `paneKey` from and no native param to write back:
 * the page is one document served at `/`, and `setParams` here would rewrite the document's own
 * history entry while the app's route kept the spent tap. The shell delivers the request instead,
 * as a re-sent `init` for the session this page already holds (ruling 33.1), and clears its own
 * param once this page has been handed one.
 *
 * The request waits in a ref and a counter wakes the effect, rather than the request living in
 * state: a tap can arrive before the terminals have loaded, and an effect that adjusted state on
 * every delivery would render the stale selection first. Counted rather than compared, because the
 * tap that matters most is the one that looks like nothing changed — a notification for the pane
 * already on screen is a real request, and deduplicating by value would drop exactly that one.
 */
export function useNotificationPaneNavigation({
  sessionTabs,
  terminalsLoaded,
  switchSessionTab
}: {
  sessionTabs: MobileSessionTab[]
  terminalsLoaded: boolean
  switchSessionTab: (tab: MobileSessionTab) => void
}) {
  const client = usePageBridgeClient()
  // Seeded from the route this page was opened on: a tap that opened the session arrives in the
  // first `init` and never as an update, so a hook that only listened would lose it.
  const pending = useRef(client.getShellSession()?.route?.params?.paneKey ?? null)
  const [delivered, setDelivered] = useState(0)

  useEffect(
    () =>
      client.onRouteUpdate((route) => {
        const paneKey = route?.params?.paneKey ?? ''
        if (paneKey === '') {
          return
        }
        pending.current = paneKey
        setDelivered((count) => count + 1)
      }),
    [client]
  )

  useEffect(() => {
    const paneKey = pending.current
    if (paneKey === null || paneKey === '' || !terminalsLoaded) {
      return
    }
    // Consumed even when the pane has since closed, for the reason the native hook consumes its
    // param: a request left standing is one a later render would serve.
    pending.current = null
    const tab = notificationPaneTab(sessionTabs, paneKey)
    if (tab) {
      switchSessionTab(tab)
    }
  }, [delivered, sessionTabs, switchSessionTab, terminalsLoaded])
}
