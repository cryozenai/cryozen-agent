import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type { ConnectionTargetState, ConnectorsConnectResult } from '@cryozen/shared'
import { type RefObject, useEffect, useRef, useState } from 'react'

import { ToolFallback } from '@/components/assistant-ui/tool/fallback'
import { type ConnectorRowMark } from '@/components/ui/connector-card'
import type { useI18n } from '@/i18n'
import { connectorAuthorizationUrl, recordOf, toolLabels, toolLabelTitle } from '@/lib/connector-tools'
import {
  type ConnectionOwner,
  connectionOwnerFor,
  type ConnectionRequest,
  connectionRequestOpen,
  type ConnectionTarget
} from '@/store/connection-request'
import { requestGatewayForAgent } from '@/store/gateway'

/** Resolve that owner. Null until it resolves and null when it cannot: a card RPC must reach the
 *  gateway that holds the operation, never whichever one the window happens to have in front. */
export function useConnectionOwner(sessionId: null | string, active: boolean): ConnectionOwner | null {
  const [owner, setOwner] = useState<ConnectionOwner | null>(null)

  useEffect(() => {
    if (!sessionId || !active) {
      setOwner(null)

      return
    }

    let cancelled = false

    void connectionOwnerFor(sessionId, 'connectors.connect').then(resolved => {
      if (!cancelled) {
        setOwner(resolved)
      }
    })

    return () => {
      cancelled = true
    }
  }, [active, sessionId])

  return owner
}

/** Try again for one target of the open operation: one RPC, and the fresh link when the backend
 *  minted one. The backend re-mints only what is actually dead. A settled operation is dead: the
 *  RPC would open a second one that no card on this row can answer. */
export async function reissueConnectionTarget(
  owner: ConnectionOwner,
  request: ConnectionRequest,
  name: string
): Promise<null | string> {
  if (!connectionRequestOpen(request)) {
    return null
  }

  const reply = await requestGatewayForAgent<ConnectorsConnectResult>(
    owner.connectionId,
    owner.profile,
    'connectors.connect',
    {
      connectors: [name],
      owner: { session_id: request.sessionId, type: 'session' },
      reconnect: true
    },
    45000
  )

  const minted = reply.targets.find(target => target.name === name)

  return connectorAuthorizationUrl(minted?.connect_url)
}

/** The card lives on the tool row whose id opened the operation and on no other. */
export function connectionRequestOwnsPart(props: ToolCallMessagePartProps, request: ConnectionRequest | null): boolean {
  return Boolean(request && props.toolCallId === request.toolCallId)
}

type ConnectorCopy = ReturnType<typeof useI18n>['t']['connectors']
type ConnectorVerb = 'none' | 'open' | 'reissue'

/** The settled row's word; the card never says why. */
interface SettledWord {
  meta: string
  tone?: 'ok'
}

interface ConnectorCardPhase {
  mark: ConnectorRowMark
  resolved: boolean
  settled: (copy: ConnectorCopy) => SettledWord
  verb: ConnectorVerb
}

const connected = (copy: ConnectorCopy): SettledWord => ({ meta: copy.connected, tone: 'ok' })
const notConnected = (copy: ConnectorCopy): SettledWord => ({ meta: copy.notConnected })
const skipped = (copy: ConnectorCopy): SettledWord => ({ meta: copy.skipped })

export const CONNECTOR_CARD_PHASES = {
  connected: { mark: 'connected', resolved: true, settled: connected, verb: 'none' },
  failed: { mark: 'idle', resolved: false, settled: notConnected, verb: 'reissue' },
  initiated: { mark: 'waiting', resolved: false, settled: notConnected, verb: 'open' },
  not_connected: { mark: 'idle', resolved: false, settled: notConnected, verb: 'none' },
  pending: { mark: 'idle', resolved: false, settled: notConnected, verb: 'open' },
  skipped: { mark: 'idle', resolved: true, settled: skipped, verb: 'none' }
} satisfies Record<ConnectionTargetState, ConnectorCardPhase>

// A disabled verb (a working row, a waiting row with no link yet) refuses focus, and the keyboard
// would land on the document body; so the first control that can take it, else the row itself.
const FOCUSABLE_IN_ROW = 'button:not([disabled]), [href], input:not([disabled])'
// The user is typing a credential; a row moving elsewhere on the card must not take the keyboard.
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])'

function focusChangedRow(card: HTMLElement, name: string): void {
  const row = [...card.querySelectorAll<HTMLElement>('[data-connector-row]')].find(
    node => node.dataset.connectorRow === name
  )

  ;(row?.querySelector<HTMLElement>(FOCUSABLE_IN_ROW) ?? row)?.focus()
}

/** Move focus to the row the backend changed. Only while the card already holds focus, and never
 *  out of a field the user is typing in — a transition the user is not looking at must not take
 *  the keyboard away from wherever they are. */
export function useConnectorFocusHandoff(
  targets: readonly ConnectionTarget[],
  cardRef: RefObject<HTMLDivElement | null>
): void {
  const seen = useRef<Map<string, ConnectionTargetState> | null>(null)
  const states = targets.map(target => `${target.name}=${target.state}`).join('|')

  // The ref holds what the last frame said, for comparison only: nothing renders from it, so it
  // cannot lag a render the way a mirrored atom would.
  // eslint-disable-next-line no-restricted-syntax
  useEffect(() => {
    const previous = seen.current
    seen.current = new Map(targets.map(target => [target.name, target.state]))

    const card = cardRef.current

    const moved = targets.find(target => {
      const before = previous?.get(target.name)

      return before !== undefined && before !== target.state
    })

    const active = document.activeElement

    if (!previous || !moved || !card?.contains(active) || active?.matches(EDITABLE)) {
      return
    }

    focusChangedRow(card, moved.name)
    // The target states are the whole input; `states` changes exactly when one of them moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [states])
}

export const MARK_LABEL = {
  connected: (copy: ConnectorCopy) => copy.connected,
  idle: (copy: ConnectorCopy) => copy.notConnected,
  waiting: (copy: ConnectorCopy) => copy.waiting
} satisfies Record<ConnectorRowMark, (copy: ConnectorCopy) => string>

const MISSING_CALL_RESULT = { error: 'No result for this call.' }

/** Keep execution output in the standard disclosure, with one row per inner call.
 *  The gateway labels every call the tool_search bridge runs — hosted, MCP or local —
 *  so hosted-only, MCP-only and mixed batches all render the same way. */
export function ConnectorExecution(props: ToolCallMessagePartProps) {
  const labels = toolLabels(props.args)
  const output = recordOf(props.result)
  const results = Array.isArray(output.results) ? output.results : []

  if (labels.length === 0) {
    return <ToolFallback {...props} />
  }

  const input = recordOf(props.args)
  const batch = Array.isArray(input.calls) ? input.calls : [input]

  return (
    <>
      {labels.map((label, index) => {
        // A hosted batch answers one result per call; anything else answers once for the
        // whole call, and every row shows that same outcome (a rejected batch, an error).
        // A batch that answered short says so on the rows it left out.
        const item = results[index] ?? (results.length > 0 ? MISSING_CALL_RESULT : props.result)
        const result = recordOf(item)

        return (
          <ToolFallback
            {...props}
            args={recordOf(recordOf(batch[index]).arguments ?? props.args)}
            isError={Boolean(result.error) || props.isError === true}
            key={`${props.toolCallId}:${index}`}
            result={item}
            toolCallId={`${props.toolCallId}:${index}`}
            toolName={toolLabelTitle(label)}
          />
        )
      })}
    </>
  )
}
