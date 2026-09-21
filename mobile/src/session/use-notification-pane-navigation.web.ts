import { useEffect, useState } from 'react'
import { usePageBridgeClient } from '../transport/client-context.web'
import type { MobileSessionTab } from './mobile-session-route-types'
import { notificationPaneTab } from './notification-pane-tab'

/** One tap. The ordinal is what tells a repeat tap for the pane already showing from a re-render. */
type PaneRequest = { readonly paneKey: string; readonly ordinal: number }

/**
 * Web sibling: the pane a notification tap asked for, read off the shell rather than off a router.
 *
 * On the page there is no native route to read `paneKey` from and no native param to write back:
 * the page is one document served at `/`, and `setParams` here would rewrite the document's own
 * history entry while the app's route kept the spent tap. The shell delivers the request instead,
 * as a re-sent `init` for the session this page already holds (ruling 33.1), and clears its own
 * param once this page has been handed one.
 *
 * Counted rather than compared, because the tap that matters most is the one that looks like
 * nothing changed: a notification for the pane already on screen is a real request, and a hook
 * that deduplicated by value would drop exactly that one. The ordinal makes each delivery its own
 * request, and the effect below consumes it.
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
  const [request, setRequest] = useState<PaneRequest | null>(() => {
    const paneKey = client.getShellSession()?.route?.params?.paneKey ?? ''
    return paneKey === '' ? null : { paneKey, ordinal: 0 }
  })

  useEffect(
    () =>
      client.onRouteUpdate((route) => {
        const paneKey = route?.params?.paneKey ?? ''
        if (paneKey === '') {
          return
        }
        setRequest((held) => ({ paneKey, ordinal: (held?.ordinal ?? 0) + 1 }))
      }),
    [client]
  )

  useEffect(() => {
    if (request === null || !terminalsLoaded) {
      return
    }
    const tab = notificationPaneTab(sessionTabs, request.paneKey)
    // Consumed even when the pane was closed, for the reason the native hook consumes its param:
    // a request left standing is one a later render would serve.
    setRequest(null)
    if (tab) {
      switchSessionTab(tab)
    }
  }, [request, sessionTabs, switchSessionTab, terminalsLoaded])
}
