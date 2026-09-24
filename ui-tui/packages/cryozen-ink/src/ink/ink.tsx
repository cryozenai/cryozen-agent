import { closeSync, constants as fsConstants, openSync, readSync, writeSync } from 'fs'
import { format } from 'util'

import autoBind from 'auto-bind'
import noop from 'lodash-es/noop.js'
import throttle from 'lodash-es/throttle.js'
import React, { type ReactNode } from 'react'
import type { FiberRoot } from 'react-reconciler'
import { ConcurrentRoot } from 'react-reconciler/constants.js'
import { onExit } from 'signal-exit'

import { flushInteractionTime } from '../bootstrap/state.js'
import { getYogaCounters } from '../native-ts/yoga-layout/index.js'
import { logForDebugging } from '../utils/debug.js'
import { logError } from '../utils/log.js'

import { colorize } from './colorize.js'
import App from './components/App.js'
import type { CursorAdvanceNotifier } from './components/CursorAdvanceContext.js'
import type { CursorDeclaration, CursorDeclarationSetter } from './components/CursorDeclarationContext.js'
import { FRAME_INTERVAL_MS, MAX_COALESCED_BACKPRESSURE_FRAMES } from './constants.js'
import * as dom from './dom.js'
import { markDirty } from './dom.js'
import { KeyboardEvent } from './events/keyboard-event.js'
import { FocusManager } from './focus.js'
import { emptyFrame, type Frame, type FrameEvent } from './frame.js'
import { dispatchClick, dispatchHover, dispatchMouse } from './hit-test.js'
import { applyHyperlinkHoverHighlight } from './hyperlinkHover.js'
import instances from './instances.js'
import { LogUpdate } from './log-update.js'
import { nodeCache } from './node-cache.js'
import { optimize } from './optimizer.js'
import Output from './output.js'
import type { ParsedKey } from './parse-keypress.js'
import reconciler, {
  dispatcher,
  getLastCommitMs,
  getLastYogaMs,
  recordYogaMs,
  resetProfileCounters
} from './reconciler.js'
import renderNodeToOutput, { consumeFollowScroll, didLayoutShift } from './render-node-to-output.js'
import { applyPositionedHighlight, type MatchPosition, scanPositions } from './render-to-screen.js'
import createRenderer, { type Renderer } from './renderer.js'
import {
  cellAt,
  CellWidth,
  CharPool,
  createScreen,
  HyperlinkPool,
  isEmptyCellAt,
  migrateScreenPools,
  StylePool
} from './screen.js'
import { applySearchHighlight } from './searchHighlight.js'
import {
  applySelectionOverlay,
  captureScrolledRows,
  clearSelection,
  createSelectionState,
  extendSelection,
  findPlainTextUrlAt,
  type FocusMove,
  getSelectedText,
  hasSelection,
  moveFocus,
  selectionBounds,
  selectionSignature,
  type SelectionState,
  selectLineAt,
  selectWordAt,
  shiftAnchor,
  shiftSelection,
  shiftSelectionForFollow,
  startSelection,
  updateSelection
} from './selection.js'
import {
  needsAltScreenResizeScrollbackClear,
  skipKittyKeyboardProtocol,
  supportsExtendedKeys,
  SYNC_OUTPUT_SUPPORTED,
  type Terminal,
  writeDiffToTerminal
} from './terminal.js'
import {
  CURSOR_HOME,
  cursorMove,
  cursorPosition,
  DISABLE_KITTY_KEYBOARD,
  DISABLE_MODIFY_OTHER_KEYS,
  ENABLE_KITTY_KEYBOARD,
  ENABLE_MODIFY_OTHER_KEYS,
  ERASE_SCREEN,
  ERASE_SCROLLBACK
} from './termio/csi.js'
import {
  DBP,
  DFE,
  DISABLE_MOUSE_TRACKING,
  enableMouseTrackingFor,
  ENTER_ALT_SCREEN,
  EXIT_ALT_SCREEN,
  type MouseTrackingMode,
  SHOW_CURSOR
} from './termio/dec.js'
import { isDashboardHosted } from './termio/host.js'
import {
  CLEAR_ITERM2_PROGRESS,
  CLEAR_TAB_STATUS,
  setClipboard,
  supportsTabStatus,
  wrapForMultiplexer
} from './termio/osc.js'
import { TerminalWriteProvider } from './useTerminalNotification.js'

// Alt-screen: renderer.ts sets cursor.visible = !isTTY || screen.height===0,
// which is always false in alt-screen (TTY + content fills screen).
// Reusing a frozen object saves 1 allocation per frame.
const ALT_SCREEN_ANCHOR_CURSOR = Object.freeze({
  x: 0,
  y: 0,
  visible: false
})

const CURSOR_HOME_PATCH = Object.freeze({
  type: 'stdout' as const,
  content: CURSOR_HOME
})

const ERASE_THEN_HOME_PATCH = Object.freeze({
  type: 'stdout' as const,
  content: ERASE_SCREEN + CURSOR_HOME
})

const DEEP_ERASE_THEN_HOME_PATCH = Object.freeze({
  type: 'stdout' as const,
  content: ERASE_SCREEN + ERASE_SCROLLBACK + CURSOR_HOME
})

// Cached per-Ink-instance, invalidated on resize. frame.cursor.y for
// alt-screen is always terminalRows - 1 (renderer.ts).
function makeAltScreenParkPatch(terminalRows: number) {
  return Object.freeze({
    type: 'stdout' as const,
    content: cursorPosition(terminalRows, 1)
  })
}

export type Options = {
  stdout: NodeJS.WriteStream
  stdin: NodeJS.ReadStream
  stderr: NodeJS.WriteStream
  exitOnCtrlC: boolean
  patchConsole: boolean
  waitUntilExit?: () => Promise<void>
  onFrame?: (event: FrameEvent) => void
  /**
   * Called when a click lands on a cell with an OSC 8 hyperlink (or a
   * plain-text URL detected by findPlainTextUrlAt). The host is responsible
   * for opening the URL — `child_process.spawn` with an argv array (NOT
   * shell-mode) to the platform's native opener: `open` on macOS,
   * `xdg-open` on Linux/BSD, `explorer.exe` on Windows. Avoid
   * `cmd.exe /c start` — `start` is a cmd builtin that reparses the URL
   * through cmd's tokenizer (`&` / `|` / `^` / `<` / `>` get split or
   * reinterpreted), which both breaks plain URLs with `&` in query
   * strings and undermines any caller-side protocol allowlist. Without
   * this wired up, links rendered by `<Link>` look underlined but do
   * nothing on click in any terminal where mouse tracking is on
   * (Cmd+click is consumed by the TUI, not Terminal.app).
   */
  onHyperlinkClick?: (url: string) => void
}
export default class Ink {
  private readonly log: LogUpdate
  private readonly terminal: Terminal
  private scheduleRender: (() => void) & {
    cancel?: () => void
  }
  // Ignore last render after unmounting a tree to prevent empty output before exit
  private isUnmounted = false
  private isPaused = false
  private readonly container: FiberRoot
  private rootNode: dom.DOMElement
  readonly focusManager: FocusManager
  private renderer: Renderer
  private readonly stylePool: StylePool
  private charPool: CharPool
  private hyperlinkPool: HyperlinkPool
  private exitPromise?: Promise<void>
  private restoreConsole?: () => void
  private restoreStderr?: () => void
  private readonly unsubscribeTTYHandlers?: () => void
  private terminalColumns: number
  private terminalRows: number
  private currentNode: ReactNode = null
  private frontFrame: Frame
  private backFrame: Frame
  private lastPoolResetTime = performance.now()
  private drainTimer: ReturnType<typeof setTimeout> | null = null
  // Write-drain telemetry: pendingWriteStart is the performance.now() of
  // the most recent stdout.write waiting for its drain callback.  Set to
  // null when the callback fires (drained).  Read on the NEXT frame and
  // reported as prevFrameDrainMs so the FrameEvent records how long the
  // previous write took to actually hit the terminal — distinguishes
  // "queued in Node" (write returned true) from "terminal accepted bytes"
  // (callback fired).
  private pendingWriteStart: number | null = null
  private lastDrainMs = 0
  // Issue #31486: count of consecutive frames skipped because the previous
  // write hadn't drained. Reset to 0 whenever a frame actually writes (or the
  // pipe has drained). Capped by MAX_COALESCED_BACKPRESSURE_FRAMES so a
  // never-firing drain callback can't coalesce forever.
  private coalescedBackpressureFrames = 0
  private lastYogaCounters: {
    ms: number
    visited: number
    measured: number
    cacheHits: number
    live: number
  } = {
    ms: 0,
    visited: 0,
    measured: 0,
    cacheHits: 0,
    live: 0
  }
  private altScreenParkPatch: Readonly<{
    type: 'stdout'
    content: string
  }>
  // Text selection state (alt-screen only). Owned here so the overlay
  // pass in onRender can read it and App.tsx can update it from mouse
  // events. Public so instances.get() callers can access.
  readonly selection: SelectionState = createSelectionState()
  // Search highlight query (alt-screen only). Setter below triggers
  // scheduleRender; applySearchHighlight in onRender inverts matching cells.
  private searchHighlightQuery = ''
  // Position-based highlight. VML scans positions ONCE (via
  // scanElementSubtree, when the target message is mounted), stores them
  // message-relative, sets this for every-frame apply. rowOffset =
  // message's current screen-top. currentIdx = which position is
  // "current" (yellow). null clears. Positions are known upfront —
  // navigation is index arithmetic, no scan-feedback loop.
  private searchPositions: {
    positions: MatchPosition[]
    rowOffset: number
    currentIdx: number
  } | null = null
  // React-land subscribers for selection state changes (useHasSelection).
  // Fired alongside the terminal repaint whenever the selection mutates
  // so UI (e.g. footer hints) can react to selection appearing/clearing.
  private readonly selectionListeners = new Set<() => void>()
  private selectionVersion = 0
  private lastSelectionSignature = ''
  // DOM nodes currently under the pointer (mode-1003 motion). Held here
  // so App.tsx's handleMouseEvent is stateless — dispatchHover diffs
  // against this set and mutates it in place.
  private readonly hoveredNodes = new Set<dom.DOMElement>()

  // The OSC 8 hyperlink URL under the pointer, or undefined when the cursor
  // isn't on a link. Updated from dispatchHover; consumed by the render-pass
  // overlay (applyHyperlinkHoverHighlight) to invert link cells under the
  // pointer. This is the closest the TUI can get to the desktop's
  // cursor-changes-on-hover affordance — terminals don't expose cursor
  // shape control to applications.
  private hoveredHyperlink: string | undefined = undefined

  // Last value of hoveredHyperlink that we actually painted. Compared in
  // onRender so we can scope full-screen damage to enter/leave/change
  // transitions, not every steady-state hover frame.
  private lastRenderedHoveredHyperlink: string | undefined = undefined
  // Set by <AlternateScreen> via setAltScreenActive(). Controls the
  // renderer's cursor.y clamping (keeps cursor in-viewport to avoid
  // LF-induced scroll when screen.height === terminalRows) and gates
  // alt-screen-aware SIGCONT/resize/unmount handling.
  private altScreenActive = false
  // Set alongside altScreenActive so SIGCONT resume knows which mouse
  // tracking preset to re-enable (not all <AlternateScreen> uses want
  // tracking, and tmux users routinely opt into the hover-free 'wheel'
  // subset to silence prompt-row clipboard probes).
  private altScreenMouseTracking: MouseTrackingMode = 'off'
  // True when the previous frame's screen buffer cannot be trusted for
  // blit — selection overlay mutated it, resetFramesForAltScreen()
  // replaced it with blanks, or forceRedraw() reset it to 0×0. Forces
  // one full-render frame; steady-state frames after clear it and regain
  // the blit + narrow-damage fast path.
  private prevFrameContaminated = false
  // Set by handleResize: prepend ERASE_SCREEN to the next onRender's patches
  // INSIDE the BSU/ESU block so clear+paint is atomic. Writing ERASE_SCREEN
  // synchronously in handleResize would leave the screen blank for the ~80ms
  // render() takes; deferring into the atomic block means old content stays
  // visible until the new frame is fully ready.
  private needsEraseBeforePaint = false
  // Scopes the scrollback-deep erase (CSI 3J) to resize healing only. Apple
  // Terminal preserves alt-screen reflow artifacts in scrollback across a
  // resize, which is the one case worth clearing history for. Other erase
  // requesters (focus regain) must stay 2J-only — wiping the user's
  // scrollback on an ordinary tab switch is data loss, not recovery.
  private needsDeepEraseBeforePaint = false
  // Native cursor positioning: a component (via useDeclaredCursor) declares
  // where the terminal cursor should be parked after each frame. Terminal
  // emulators render IME preedit text at the physical cursor position, and
  // screen readers / screen magnifiers track it — so parking at the text
  // input's caret makes CJK input appear inline and lets a11y tools follow.
  private cursorDeclaration: CursorDeclaration | null = null
  // Main-screen: physical cursor position after the declared-cursor move,
  // tracked separately from frame.cursor (which must stay at content-bottom
  // for log-update's relative-move invariants). Alt-screen doesn't need
  // this — every frame begins with CSI H. null = no move emitted last frame.
  private displayCursor: {
    x: number
    y: number
  } | null = null
  // Burst of SIGWINCH (vscode panel drag) → one React commit per
  // microtask. Dims are captured sync in handleResize; only the
  // expensive tree rebuild defers.
  private pendingResizeRender = false
  private resizeSettleTimer: ReturnType<typeof setTimeout> | null = null

  // Fold synchronous re-entry (selection fanout, onFrame callback)
  // into one follow-up microtask instead of stacking renders.
  private isRendering = false
  private immediateRerenderRequested = false
  private selectionDragCell: { col: number; row: number } | null = null
  private selectionAutoScrollTimer: ReturnType<typeof setInterval> | null = null
  private selectionAutoScrollDir: -1 | 0 | 1 = 0
  constructor(private readonly options: Options) {
    autoBind(this)

    if (this.options.patchConsole) {
      this.restoreConsole = this.patchConsole()
      this.restoreStderr = this.patchStderr()
    }

    // Host-supplied hyperlink-open callback. The mouse-event pipeline
    // (App.tsx → onOpenHyperlink → Ink.openHyperlink → onHyperlinkClick)
    // is fully wired internally; without this assignment the optional
    // chain in openHyperlink() bails silently and clicks on URLs do
    // nothing. The field stays writable so tests / debug overlays can
    // still rebind it after construction.
    this.onHyperlinkClick = options.onHyperlinkClick

    this.terminal = {
      stdout: options.stdout,
      stderr: options.stderr
    }
    this.terminalColumns = options.stdout.columns || 80
    this.terminalRows = options.stdout.rows || 24
    this.altScreenParkPatch = makeAltScreenParkPatch(this.terminalRows)
    this.stylePool = new StylePool()
    this.charPool = new CharPool()
    this.hyperlinkPool = new HyperlinkPool()
    this.frontFrame = emptyFrame(
      this.terminalRows,
      this.terminalColumns,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool
    )
    this.backFrame = emptyFrame(
      this.terminalRows,
      this.terminalColumns,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool
    )
    this.log = new LogUpdate({
      isTTY: (options.stdout.isTTY as boolean | undefined) || false,
      stylePool: this.stylePool
    })

    // scheduleRender is called from the reconciler's resetAfterCommit, which
    // runs BEFORE React's layout phase (ref attach + useLayoutEffect). Any
    // state set in layout effects — notably the cursorDeclaration from
    // useDeclaredCursor — would lag one commit behind if we rendered
    // synchronously. Deferring to a microtask runs onRender after layout
    // effects have committed, so the native cursor tracks the caret without
    // a one-keystroke lag. Same event-loop tick, so throughput is unchanged.
    // Test env uses onImmediateRender (direct onRender, no throttle) so
    // existing synchronous lastFrame() tests are unaffected.
    const deferredRender = (): void => queueMicrotask(this.onRender)
    this.scheduleRender = throttle(deferredRender, FRAME_INTERVAL_MS, {
      leading: true,
      trailing: true
    })

    // Ignore last render after unmounting a tree to prevent empty output before exit
    this.isUnmounted = false

    // Unmount when process exits
    this.unsubscribeExit = onExit(this.unmount, {
      alwaysLast: false
    })

    if (options.stdout.isTTY) {
      options.stdout.on('resize', this.handleResize)
      process.on('SIGCONT', this.handleResume)

      this.unsubscribeTTYHandlers = () => {
        options.stdout.off('resize', this.handleResize)
        process.off('SIGCONT', this.handleResume)
      }
    }

    this.rootNode = dom.createNode('ink-root')
    this.focusManager = new FocusManager((target, event) => dispatcher.dispatchDiscrete(target, event))
    this.rootNode.focusManager = this.focusManager
    this.renderer = createRenderer(this.rootNode, this.stylePool)
    this.rootNode.onRender = this.scheduleRender
    this.rootNode.onImmediateRender = this.onRender

    this.rootNode.onComputeLayout = () => {
      // Calculate layout during React's commit phase so useLayoutEffect hooks
      // have access to fresh layout data
      // Guard against accessing freed Yoga nodes after unmount
      if (this.isUnmounted) {
        return
      }

      if (this.rootNode.yogaNode) {
        const t0 = performance.now()
        this.rootNode.yogaNode.setWidth(this.terminalColumns)
        this.rootNode.yogaNode.calculateLayout(this.terminalColumns)
        const ms = performance.now() - t0
        recordYogaMs(ms)
        const c = getYogaCounters()
        this.lastYogaCounters = {
          ms,
          ...c
        }
      }
    }

    this.container = reconciler.createContainer(
      this.rootNode,
      ConcurrentRoot,
      null,
      false,
      null,
      'id',
      noop,
      // onUncaughtError
      noop,
      // onCaughtError
      noop,
      // onRecoverableError
      noop // onDefaultTransitionIndicator
    )

    if (process.env.NODE_ENV === 'development') {
      reconciler.injectIntoDevTools({
        bundleType: 0,
        // Reporting React DOM's version, not Ink's
        // See https://github.com/facebook/react/issues/16666#issuecomment-532639905
        version: '16.13.1',
        rendererPackageName: 'ink'
      })
    }
  }
  private handleResume = () => {
    if (!this.options.stdout.isTTY) {
      return
    }

    // Alt screen: after SIGCONT, content is stale (shell may have written
    // to main screen, switching focus away) and mouse tracking was
    // disabled by handleSuspend.
    if (this.altScreenActive) {
      this.reenterAltScreen()

      return
    }

    // Main screen: start fresh to prevent clobbering terminal content
    this.frontFrame = emptyFrame(
      this.frontFrame.viewport.height,
      this.frontFrame.viewport.width,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool
    )
    this.backFrame = emptyFrame(
      this.backFrame.viewport.height,
      this.backFrame.viewport.width,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool
    )
    this.log.reset()
    // Physical cursor position is unknown after the shell took over during
    // suspend. Clear displayCursor so the next frame's cursor preamble
    // doesn't emit a relative move from a stale park position.
    this.displayCursor = null
  }

  // Dims captured sync — closes the stale-dim window the original
  // debounce rejection warned about. Expensive React commit defers to
  // one microtask per burst: vscode fires many SIGWINCHes per panel
  // drag, each ~80ms uncoalesced = event loop visibly locks up.
  private handleResize = () => {
    const cols = this.options.stdout.columns || 80
    const rows = this.options.stdout.rows || 24
    const dimsChanged = cols !== this.terminalColumns || rows !== this.terminalRows

    // Terminals often emit 2+ resize events for one user action
    // (window settling). Same-dimension events are usually no-ops,
    // but in alt-screen mode a same-dimension resize can signal a
    // terminal host reflow or buffer restore that leaves stale glyphs
    // on the physical screen — treat it as a repaint signal.
    if (!dimsChanged && !(this.altScreenActive && !this.isPaused && this.options.stdout.isTTY)) {
      return
    }

    if (dimsChanged) {
      this.terminalColumns = cols
      this.terminalRows = rows
      this.altScreenParkPatch = makeAltScreenParkPatch(this.terminalRows)
    }

    // Pending throttled/drain work captured stale dims — cancel so
    // the upcoming microtask owns the next frame.
    this.scheduleRender.cancel?.()

    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }

    if (this.resizeSettleTimer !== null) {
      clearTimeout(this.resizeSettleTimer)
      this.resizeSettleTimer = null
    }

    // Alt screen: reset frame buffers so the next render repaints from
    // scratch (prevFrameContaminated → every cell written, wrapped in
    // BSU/ESU — old content stays visible until the new frame swaps
    // atomically). Re-assert mouse tracking (some emulators reset it on
    // resize). Do NOT write ENTER_ALT_SCREEN: iTerm2 treats ?1049h as a
    // buffer clear even when already in alt — that's the blank flicker.
    // Self-healing re-entry (if something kicked us out of alt) is handled
    // by handleResume (SIGCONT) and the sleep-wake detector; resize itself
    // doesn't exit alt-screen. Do NOT write ERASE_SCREEN: render() below
    // can take ~80ms; erasing first leaves the screen blank that whole time.
    if (this.altScreenActive && !this.isPaused && this.options.stdout.isTTY) {
      this.prepareAltScreenResizeRepaint()
    }

    // Already queued: later events in this burst updated dims/alt-screen
    // prep above; the queued render picks up the latest values when it
    // fires (React commit → onComputeLayout → scheduleRender → onRender).
    if (this.pendingResizeRender) {
      return
    }

    this.pendingResizeRender = true

    queueMicrotask(() => {
      this.pendingResizeRender = false

      if (this.isUnmounted || this.currentNode === null) {
        return
      }

      this.render(this.currentNode)
    })
  }

  private canAltScreenRepaint(): boolean {
    return (
      !this.isUnmounted &&
      !this.isPaused &&
      this.altScreenActive &&
      !!this.options.stdout.isTTY &&
      this.currentNode !== null
    )
  }

  private prepareAltScreenResizeRepaint(): void {
    // Clear any pending settle timer from a previous resize burst so
    // rapid events don't stack redundant delayed repaints. (handleResize
    // also clears this, but the defensive clear keeps the method safe
    // if it's ever called from other code paths.)
    if (this.resizeSettleTimer !== null) {
      clearTimeout(this.resizeSettleTimer)
      this.resizeSettleTimer = null
    }

    // Mouse tracking — DISABLE first so we land in the exact preset state
    // even if an external app/terminal/tmux left DEC 1003 hover asserted.
    // DISABLE_MOUSE_TRACKING is idempotent (resets all four modes
    // unconditionally), safe to send even when current preset is 'off'.
    this.options.stdout.write(DISABLE_MOUSE_TRACKING + enableMouseTrackingFor(this.altScreenMouseTracking))

    this.resetFramesForAltScreen()
    this.needsEraseBeforePaint = true
    this.needsDeepEraseBeforePaint = true

    this.resizeSettleTimer = setTimeout(() => {
      this.resizeSettleTimer = null

      if (!this.canAltScreenRepaint()) {
        return
      }

      this.resetFramesForAltScreen()
      this.needsEraseBeforePaint = true
      this.needsDeepEraseBeforePaint = true
      this.render(this.currentNode!)
    }, 160)
  }

  private handleTerminalFocusChange(isFocused: boolean): void {
    if (!isFocused || !this.options.stdout.isTTY) {
      return
    }

    // Focus-in means the terminal emulator has just made this tab/pane
    // visible again. Some emulators throttle or coalesce hidden-tab output;
    // if we continue with the pre-blur virtual cursor/backbuffer, only the
    // next small dirty region may repaint and stale status/progress rows can
    // remain visible. Defer one tick so TerminalFocusProvider subscribers
    // observe the new focus state first, then reset the virtual frames and
    // repaint from scratch.
    //
    // The clear is required (a row that is BLANK in the new frame is skipped
    // by the diff, so a stale row survives a buffer-only reset), but it is
    // queued via needsEraseBeforePaint rather than written directly: that
    // folds it into this frame's patch list so clear+paint reach the terminal
    // in ONE write. forceRedraw()'s separate stdout.write(ERASE_SCREEN) is
    // what makes an ordinary tab switch flash a blank screen.
    //
    // Modes are re-asserted too: an emulator that dropped DEC mouse tracking
    // while the pane was hidden would otherwise stay dead until the DECRQM
    // watchdog's next 2s probe. reassertTerminalModes(false) is the
    // non-destructive form — extended keys + mouse preset, no alt-screen
    // re-entry, no erase — so it costs a few idempotent bytes and no flicker.
    //
    // Under the dashboard the emulator is xterm.js over a WebSocket: it never
    // drops hidden-tab writes, so the clear+repaint is only a flash on every
    // OS app-switch. Re-assert modes and stop; the focus report still reaches
    // TerminalFocusProvider.
    queueMicrotask(() => {
      if (this.isUnmounted || this.isPaused || !this.options.stdout.isTTY || this.currentNode === null) {
        return
      }

      this.reassertTerminalModes(false)

      if (isDashboardHosted()) {
        return
      }

      if (this.altScreenActive) {
        this.resetFramesForAltScreen()
      } else {
        this.repaint()
        this.invalidatePrevFrame()
      }

      this.needsEraseBeforePaint = true
      this.onRender()
    })
  }

  resolveExitPromise: () => void = () => {}
  rejectExitPromise: (reason?: Error) => void = () => {}
  unsubscribeExit: () => void = () => {}

  /**
   * Pause Ink and hand the terminal over to an external TUI (e.g. git
   * commit editor). In non-fullscreen mode this enters the alt screen;
   * in fullscreen mode we're already in alt so we just clear it.
   * Call `exitAlternateScreen()` when done to restore Ink.
   */
  enterAlternateScreen(): void {
    this.pause()
    this.suspendStdin()
    this.options.stdout.write(
      // Disable extended key reporting first — editors that don't speak
      // CSI-u (e.g. nano) show "Unknown sequence" for every Ctrl-<key> if
      // kitty/modifyOtherKeys stays active. exitAlternateScreen re-enables.
      DISABLE_KITTY_KEYBOARD +
        DISABLE_MODIFY_OTHER_KEYS +
        (this.altScreenMouseTracking !== 'off' ? DISABLE_MOUSE_TRACKING : '') +
        // disable mouse (no-op if off)
        (this.altScreenActive ? '' : '\x1b[?1049h') +
        // enter alt (already in alt if fullscreen)
        '\x1b[?1004l' +
        // disable focus reporting
        '\x1b[0m' +
        // reset attributes
        '\x1b[?25h' +
        // show cursor
        '\x1b[2J' +
        // clear screen
        '\x1b[H' // cursor home
    )
  }

  /**
   * Resume Ink after an external TUI handoff with a full repaint.
   * In non-fullscreen mode this exits the alt screen back to main;
   * in fullscreen mode we re-enter alt and clear + repaint.
   *
   * The re-enter matters: terminal editors (vim, nano, less) write
   * smcup/rmcup (?1049h/?1049l), so even though we started in alt,
   * the editor's rmcup on exit drops us to main screen. Without
   * re-entering, the 2J below wipes the user's main-screen scrollback
   * and subsequent renders land in main — native terminal scroll
   * returns, fullscreen scroll is dead.
   */
  exitAlternateScreen(): void {
    this.options.stdout.write(
      (this.altScreenActive ? ENTER_ALT_SCREEN : '') +
        // re-enter alt — vim's rmcup dropped us to main
        '\x1b[2J' +
        // clear screen (now alt if fullscreen)
        '\x1b[H' +
        // cursor home
        // DISABLE first so external editors/tmux that left DEC 1003 hover
        // on can't survive the handoff back — same pattern as
        // setAltScreenMouseTracking / reenterAltScreen.
        DISABLE_MOUSE_TRACKING +
        enableMouseTrackingFor(this.altScreenMouseTracking) +
        (this.altScreenActive ? '' : '\x1b[?1049l') +
        // exit alt (non-fullscreen only)
        '\x1b[?25l' // hide cursor (Ink manages)
    )
    this.resumeStdin()

    if (this.altScreenActive) {
      this.resetFramesForAltScreen()
    } else {
      this.repaint()
    }

    this.resume()
    // Re-enable focus reporting and extended key reporting — terminal
    // editors (vim, nano, etc.) write their own modifyOtherKeys level on
    // entry and reset it on exit, leaving us unable to distinguish
    // ctrl+shift+<letter> from ctrl+<letter>. Pop-before-push keeps the
    // Kitty stack balanced (a well-behaved editor restores our entry, so
    // without the pop we'd accumulate depth on each editor round-trip).
    this.options.stdout.write(
      '\x1b[?1004h' +
        (supportsExtendedKeys()
          ? DISABLE_KITTY_KEYBOARD +
            (skipKittyKeyboardProtocol() ? '' : ENABLE_KITTY_KEYBOARD) +
            ENABLE_MODIFY_OTHER_KEYS
          : '')
    )
  }
  onRender() {
    if (this.isUnmounted || this.isPaused) {
      return
    }

    // Fold synchronous re-entry (selection fanout, onFrame callback)
    // into one follow-up microtask — back-to-back renders within one
    // macrotask were the freeze multiplier.
    if (this.isRendering) {
      this.immediateRerenderRequested = true

      return
    }

    this.isRendering = true

    // Entering a render cancels any pending drain tick — this render will
    // handle the drain (and re-schedule below if needed). Prevents a
    // wheel-event-triggered render AND a drain-timer render both firing.
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }

    // Issue #31486 (stdout-backpressure strand): if the PREVIOUS frame's
    // stdout.write still hasn't drained (callback hasn't fired —
    // pendingWriteStart is non-null), the outer terminal is consuming bytes
    // slower than we're producing them. Piling another write on the backed-up
    // pipe is wasted work AND keeps the macrotask queue hot, which is what
    // starves the stdin 'readable' callback and wedges input. Coalesce:
    // skip this frame's render+write entirely and retry on the drain tick.
    // The ceiling guarantees forward progress — after N coalesced frames we
    // force the write through, so a terminal whose drain callback NEVER fires
    // (e.g. OSError EIO on flush) self-heals once the pipe recovers instead of
    // coalescing forever. Only on a TTY; piped stdout has no flow control and
    // pendingWriteStart is never set there.
    if (
      this.options.stdout.isTTY &&
      this.pendingWriteStart !== null &&
      this.coalescedBackpressureFrames < MAX_COALESCED_BACKPRESSURE_FRAMES
    ) {
      this.coalescedBackpressureFrames += 1
      this.isRendering = false
      // Retry at the same cadence as a scroll drain tick. Don't use
      // scheduleRender — lodash throttle's leading edge would re-enter here.
      this.drainTimer = setTimeout(() => this.onRender(), FRAME_INTERVAL_MS >> 2)

      return
    }

    // Either we wrote, or we hit the ceiling and are forcing a write through.
    // Reset the coalesce counter so the next backpressure episode starts fresh.
    this.coalescedBackpressureFrames = 0

    // Flush deferred interaction-time update before rendering so we call
    // Date.now() at most once per frame instead of once per keypress.
    // Done before the render to avoid dirtying state that would trigger
    // an extra React re-render cycle.
    flushInteractionTime()
    const renderStart = performance.now()
    const terminalWidth = this.options.stdout.columns || 80
    const terminalRows = this.options.stdout.rows || 24

    const frame = this.renderer({
      frontFrame: this.frontFrame,
      backFrame: this.backFrame,
      isTTY: this.options.stdout.isTTY,
      terminalWidth,
      terminalRows,
      altScreen: this.altScreenActive,
      prevFrameContaminated: this.prevFrameContaminated
    })

    const rendererMs = performance.now() - renderStart

    // Sticky/auto-follow scrolled the ScrollBox this frame. Translate the
    // selection by the same delta so the highlight stays anchored to the
    // TEXT (native terminal behavior — the selection walks up the screen
    // as content scrolls, eventually clipping at the top). frontFrame
    // still holds the PREVIOUS frame's screen (swap is at ~500 below), so
    // captureScrolledRows reads the rows that are about to scroll out
    // before they're overwritten — the text stays copyable until the
    // selection scrolls entirely off. During drag, focus tracks the mouse
    // (screen-local) so only anchor shifts — selection grows toward the
    // mouse as the anchor walks up. After release, both ends are text-
    // anchored and move as a block.
    const follow = consumeFollowScroll()

    if (
      follow &&
      this.selection.anchor &&
      // Only translate if the selection is ON scrollbox content. Selections
      // in the footer/prompt/StickyPromptHeader are on static text — the
      // scroll doesn't move what's under them. Without this guard, a
      // footer selection would be shifted by -delta then clamped to
      // viewportBottom, teleporting it into the scrollbox. Mirror the
      // bounds check the deleted check() in ScrollKeybindingHandler had.
      this.selection.anchor.row >= follow.viewportTop &&
      this.selection.anchor.row <= follow.viewportBottom
    ) {
      const { delta, viewportTop, viewportBottom } = follow

      // captureScrolledRows and shift* are a pair: capture grabs rows about
      // to scroll off, shift moves the selection endpoint so the same rows
      // won't intersect again next frame. Capturing without shifting leaves
      // the endpoint in place, so the SAME viewport rows re-intersect every
      // frame and scrolledOffAbove grows without bound — getSelectedText
      // then returns ever-growing text on each re-copy. Keep capture inside
      // each shift branch so the pairing can't be broken by a new guard.
      if (this.selection.isDragging) {
        if (hasSelection(this.selection)) {
          captureScrolledRows(this.selection, this.frontFrame.screen, viewportTop, viewportTop + delta - 1, 'above')
        }

        shiftAnchor(this.selection, -delta, viewportTop, viewportBottom)
      } else if (
        // Flag-3 guard: the anchor check above only proves ONE endpoint is
        // on scrollbox content. A drag from row 3 (scrollbox) into the
        // footer at row 6, then release, leaves focus outside the viewport
        // — shiftSelectionForFollow would clamp it to viewportBottom,
        // teleporting the highlight from static footer into the scrollbox.
        // Symmetric check: require BOTH ends inside to translate. A
        // straddling selection falls through to NEITHER shift NOR capture:
        // the footer endpoint pins the selection, text scrolls away under
        // the highlight, and getSelectedText reads the CURRENT screen
        // contents — no accumulation. Dragging branch doesn't need this:
        // shiftAnchor ignores focus, and the anchor DOES shift (so capture
        // is correct there even when focus is in the footer).
        !this.selection.focus ||
        (this.selection.focus.row >= viewportTop && this.selection.focus.row <= viewportBottom)
      ) {
        if (hasSelection(this.selection)) {
          captureScrolledRows(this.selection, this.frontFrame.screen, viewportTop, viewportTop + delta - 1, 'above')
        }

        const cleared = shiftSelectionForFollow(this.selection, -delta, viewportTop, viewportBottom)

        // Auto-clear (both ends overshot minRow) must notify React-land
        // so useHasSelection re-renders and the footer copy/escape hint
        // disappears. notifySelectionChange() would recurse into onRender;
        // fire the listeners directly — they schedule a React update for
        // LATER, they don't re-enter this frame.
        if (cleared) {
          for (const cb of this.selectionListeners) {
            cb()
          }
        }
      }
    }

    // Selection overlay: invert cell styles in the screen buffer itself,
    // so the diff picks up selection as ordinary cell changes and
    // LogUpdate remains a pure diff engine.
    //
    // Full-screen damage (PR #20120) is a correctness backstop for the
    // sibling-resize bleed: when flexbox siblings resize between frames
    // (spinner appears → bottom grows → scrollbox shrinks), the
    // cached-clear + clip-and-cull + setCellAt damage union can miss
    // transition cells at the boundary. But that only happens when layout
    // actually SHIFTS — didLayoutShift() tracks exactly this (any node's
    // cached yoga position/size differs from current, or a child was
    // removed). Steady-state frames (spinner rotate, clock tick, text
    // stream into fixed-height box) don't shift layout, so normal damage
    // bounds are correct and diffEach only compares the damaged region.
    //
    // Selection also requires full damage: overlay writes via setCellStyleId
    // which doesn't track damage, and prev-frame overlay cells need to be
    // compared when selection moves/clears. prevFrameContaminated covers
    // the frame-after-selection-clears case.
    let selActive = false
    let hlActive = false

    if (this.altScreenActive) {
      selActive = hasSelection(this.selection)

      if (selActive) {
        applySelectionOverlay(frame.screen, this.selection, this.stylePool)
      }

      // Scan-highlight: inverse on ALL visible matches (less/vim style).
      // Position-highlight (below) overlays CURRENT (yellow) on top.
      hlActive = applySearchHighlight(frame.screen, this.searchHighlightQuery, this.stylePool)

      // Hyperlink hover overlay: inverts every cell of the link currently
      // under the pointer. Cheap-ish (linear scan of the visible buffer),
      // only fires when hoveredHyperlink is set.
      //
      // hlActive controls full-screen damage (used by selection/search to
      // make sure the previous frame's inverted cells get re-diffed when
      // the highlight set changes). For hover, the *transition* is what
      // needs the full-damage hammer — enter / leave / change-to-other-link.
      // During steady-state hover the painted cells don't change and the
      // ordinary per-cell diff handles the no-op. Folding the steady-state
      // case into hlActive would burn full-screen diffs every frame while
      // the pointer just sits on the link.
      const hoverApplied = applyHyperlinkHoverHighlight(frame.screen, this.hoveredHyperlink, this.stylePool)
      const hoverTransition = this.hoveredHyperlink !== this.lastRenderedHoveredHyperlink
      this.lastRenderedHoveredHyperlink = this.hoveredHyperlink

      if (hoverApplied && hoverTransition) {
        hlActive = true
      }

      // Position-based CURRENT: write yellow at positions[currentIdx] +
      // rowOffset. No scanning — positions came from a prior scan when
      // the message first mounted. Message-relative + rowOffset = screen.
      if (this.searchPositions) {
        const sp = this.searchPositions

        const posApplied = applyPositionedHighlight(
          frame.screen,
          this.stylePool,
          sp.positions,
          sp.rowOffset,
          sp.currentIdx
        )

        hlActive = hlActive || posApplied
      }
    }

    // Full-damage backstop: applies on BOTH alt-screen and main-screen.
    // Layout shifts (spinner appears, status line resizes) can leave stale
    // cells at sibling boundaries that per-node damage tracking misses.
    // Selection/highlight overlays write via setCellStyleId which doesn't
    // track damage. prevFrameContaminated covers the cleanup frame.
    if (didLayoutShift() || selActive || hlActive || this.prevFrameContaminated) {
      frame.screen.damage = {
        x: 0,
        y: 0,
        width: frame.screen.width,
        height: frame.screen.height
      }
    }

    // Alt-screen: anchor the physical cursor to (0,0) before every diff.
    // All cursor moves in log-update are RELATIVE to prev.cursor; if tmux
    // (or any emulator) perturbs the physical cursor out-of-band (status
    // bar refresh, pane redraw, Cmd+K wipe), the relative moves drift and
    // content creeps up 1 row/frame. CSI H resets the physical cursor;
    // passing prev.cursor=(0,0) makes the diff compute from the same spot.
    // Self-healing against any external cursor manipulation. Main-screen
    // can't do this — cursor.y tracks scrollback rows CSI H can't reach.
    // The CSI H write is deferred until after the diff is computed so we
    // can skip it for empty diffs (no writes → physical cursor unused).
    let prevFrame = this.frontFrame

    if (this.altScreenActive) {
      prevFrame = {
        ...this.frontFrame,
        cursor: ALT_SCREEN_ANCHOR_CURSOR
      }
    }

    const tDiff = performance.now()

    const diff = this.log.render(
      prevFrame,
      frame,
      this.altScreenActive,
      // DECSTBM needs BSU/ESU atomicity — without it the outer terminal
      // renders the scrolled-but-not-yet-repainted intermediate state.
      // tmux is the main case (re-emits DECSTBM with its own timing and
      // doesn't implement DEC 2026, so SYNC_OUTPUT_SUPPORTED is false).
      SYNC_OUTPUT_SUPPORTED
    )

    const diffMs = performance.now() - tDiff
    // Swap buffers
    this.backFrame = this.frontFrame
    this.frontFrame = frame

    // Periodically reset char/hyperlink pools to prevent unbounded growth
    // during long sessions. 5 minutes is infrequent enough that the O(cells)
    // migration cost is negligible. Reuses renderStart to avoid extra clock call.
    if (renderStart - this.lastPoolResetTime > 5 * 60 * 1000) {
      this.resetPools()
      this.lastPoolResetTime = renderStart
    }

    const flickers: FrameEvent['flickers'] = []

    for (const patch of diff) {
      if (patch.type === 'clearTerminal') {
        flickers.push({
          desiredHeight: frame.screen.height,
          availableHeight: frame.viewport.height,
          reason: patch.reason
        })
      }
    }

    const tOptimize = performance.now()
    const optimized = optimize(diff)
    const optimizeMs = performance.now() - tOptimize
    const hasDiff = optimized.length > 0
    const needsAltScreenErase = this.altScreenActive && this.needsEraseBeforePaint

    if (this.altScreenActive && (hasDiff || needsAltScreenErase)) {
      // Prepend CSI H to anchor the physical cursor to (0,0) so
      // log-update's relative moves compute from a known spot (self-healing
      // against out-of-band cursor drift, see the ALT_SCREEN_ANCHOR_CURSOR
      // comment above). Append CSI row;1 H to park the cursor at the bottom
      // row (where the prompt input is) — without this, the cursor ends
      // wherever the last diff write landed (a different row every frame),
      // making iTerm2's cursor guide flicker as it chases the cursor.
      // BSU/ESU protects content atomicity but iTerm2's guide tracks cursor
      // position independently. Parking at bottom (not 0,0) keeps the guide
      // where the user's attention is.
      //
      // After resize, prepend a clear too. The diff only writes cells
      // that changed; cells where new=blank and prev-buffer=blank get skipped
      // — but the physical terminal still has stale content there (shorter
      // lines at new width leave old-width text tails visible). Apple Terminal
      // can also preserve alt-screen reflow artifacts in scrollback during
      // resize, so it gets CSI 3J in this one recovery path. When BSU/ESU is
      // supported, the clear+paint lands atomically; otherwise the final state
      // is still healed even if the repaint is visible.
      if (needsAltScreenErase) {
        this.needsEraseBeforePaint = false
        // CSI 3J only when resize healing asked for it — see
        // needsDeepEraseBeforePaint. A focus-regain erase must not take the
        // user's scrollback with it.
        const deep = this.needsDeepEraseBeforePaint && needsAltScreenResizeScrollbackClear()
        this.needsDeepEraseBeforePaint = false
        optimized.unshift(deep ? DEEP_ERASE_THEN_HOME_PATCH : ERASE_THEN_HOME_PATCH)
      } else {
        optimized.unshift(CURSOR_HOME_PATCH)
      }

      optimized.push(this.altScreenParkPatch)
    } else if (this.needsEraseBeforePaint) {
      // Main screen (INLINE_MODE / Termux). Same atomicity contract as the
      // alt-screen branch above: fold the clear into this frame's patch list
      // so clear+paint land in one write instead of a bare
      // stdout.write(ERASE_SCREEN) followed by the frame. No cursor park —
      // main-screen cursor position is meaningful (it's the prompt row) and
      // log-update already restores it. No CSI 3J: scrollback is the user's
      // history here, not a resize artifact.
      //
      // Always consume the flag, but only emit the clear when this frame
      // actually repaints: a queued erase riding a later incremental frame
      // (spinner tick) would wipe content that frame doesn't redraw.
      this.needsEraseBeforePaint = false

      if (hasDiff) {
        optimized.unshift(ERASE_THEN_HOME_PATCH)
      }
    }

    // Native cursor positioning: park the terminal cursor at the declared
    // position so IME preedit text renders inline and screen readers /
    // magnifiers can follow the input. nodeCache holds the absolute screen
    // rect populated by renderNodeToOutput this frame (including scrollTop
    // translation) — if the declared node didn't render (stale declaration
    // after remount, or scrolled out of view), it won't be in the cache
    // and no move is emitted.
    const decl = this.cursorDeclaration
    const rect = decl !== null ? nodeCache.get(decl.node) : undefined

    const target =
      decl !== null && rect !== undefined
        ? {
            x: rect.x + decl.relativeX,
            y: rect.y + decl.relativeY
          }
        : null

    const parked = this.displayCursor

    // Preserve the empty-diff zero-write fast path: skip all cursor writes
    // when nothing rendered AND the park target is unchanged.
    const targetMoved = target !== null && (parked === null || parked.x !== target.x || parked.y !== target.y)

    if (hasDiff || targetMoved || (target === null && parked !== null)) {
      // Main-screen preamble: log-update's relative moves assume the
      // physical cursor is at prevFrame.cursor. If last frame parked it
      // elsewhere, move back before the diff runs. Alt-screen's CSI H
      // already resets to (0,0) so no preamble needed.
      if (parked !== null && !this.altScreenActive && hasDiff) {
        const pdx = prevFrame.cursor.x - parked.x
        const pdy = prevFrame.cursor.y - parked.y

        if (pdx !== 0 || pdy !== 0) {
          optimized.unshift({
            type: 'stdout',
            content: cursorMove(pdx, pdy)
          })
        }
      }

      if (target !== null) {
        if (this.altScreenActive) {
          // Absolute CUP (1-indexed); next frame's CSI H resets regardless.
          // Emitted after altScreenParkPatch so the declared position wins.
          const row = Math.min(Math.max(target.y + 1, 1), terminalRows)
          const col = Math.min(Math.max(target.x + 1, 1), terminalWidth)
          optimized.push({
            type: 'stdout',
            content: cursorPosition(row, col)
          })
        } else {
          // After the diff (or preamble), cursor is at frame.cursor. If no
          // diff AND previously parked, it's still at the old park position
          // (log-update wrote nothing). Otherwise it's at frame.cursor.
          const from =
            !hasDiff && parked !== null
              ? parked
              : {
                  x: frame.cursor.x,
                  y: frame.cursor.y
                }

          const dx = target.x - from.x
          const dy = target.y - from.y

          if (dx !== 0 || dy !== 0) {
            optimized.push({
              type: 'stdout',
              content: cursorMove(dx, dy)
            })
          }
        }

        this.displayCursor = target
      } else {
        // Declaration cleared (input blur, unmount). Restore physical cursor
        // to frame.cursor before forgetting the park position — otherwise
        // displayCursor=null lies about where the cursor is, and the NEXT
        // frame's preamble (or log-update's relative moves) computes from a
        // wrong spot. The preamble above handles hasDiff; this handles
        // !hasDiff (e.g. accessibility mode where blur doesn't change
        // renderedValue since invert is identity).
        if (parked !== null && !this.altScreenActive && !hasDiff) {
          const rdx = frame.cursor.x - parked.x
          const rdy = frame.cursor.y - parked.y

          if (rdx !== 0 || rdy !== 0) {
            optimized.push({
              type: 'stdout',
              content: cursorMove(rdx, rdy)
            })
          }
        }

        this.displayCursor = null
      }
    }

    const tWrite = performance.now()

    // Capture any stale pending write BEFORE starting this frame's write —
    // if the callback already fired, pendingWriteStart is null and lastDrainMs
    // already reflects the previous frame's drain.  If it hasn't fired, we
    // report "still pending" via a non-zero duration based on now-then so
    // backpressure shows up even if Node never flushes this session.
    const staleDrain = this.pendingWriteStart !== null ? performance.now() - this.pendingWriteStart : this.lastDrainMs

    const prevFrameDrainMs = Math.round(staleDrain * 100) / 100
    this.lastDrainMs = 0

    // Only track drain on TTY. Piped/non-TTY stdout bypasses flow control.
    const trackDrain = this.options.stdout.isTTY && optimized.length > 0
    const drainStart = trackDrain ? tWrite : 0

    if (trackDrain) {
      this.pendingWriteStart = drainStart
    }

    const { bytes: writeBytes, backpressure } = writeDiffToTerminal(
      this.terminal,
      optimized,
      // Never emit BSU/ESU (DEC 2026) on terminals that don't support it —
      // main screen included. Multiplexers like Zellij re-parse and re-chunk
      // the stream with their own timing, so the markers buy no atomicity and
      // stale frames get pushed into main-screen scrollback as repeated
      // chrome (#66490). Supported terminals keep today's behavior on both
      // screens (skip=false → BSU/ESU wrapped).
      !SYNC_OUTPUT_SUPPORTED,
      trackDrain
        ? () => {
            // Callback fires once Node has flushed the chunk to the OS.
            // Capture the drain time and clear pending so the NEXT frame's
            // staleDrain = the real end-to-end flush time.
            if (this.pendingWriteStart === drainStart) {
              this.lastDrainMs = performance.now() - drainStart
              this.pendingWriteStart = null
            }
          }
        : undefined
    )

    const writeMs = performance.now() - tWrite

    // Update blit safety for the NEXT frame. The frame just rendered
    // becomes frontFrame (= next frame's prevScreen). If we applied the
    // selection overlay, that buffer has inverted cells. selActive/hlActive
    // are only ever true in alt-screen; in main-screen this is false→false.
    this.prevFrameContaminated = selActive || hlActive || !!frame.absoluteOverlayMoved

    // Plain setTimeout (not scheduleRender) — lodash throttle's leading
    // edge would fire inside this trailing invocation and double-render.
    // Scroll drain only; absolute-overlay movement rides prevFrameContaminated
    // into the next natural render. Routing it here made caret re-layout a
    // 250fps self-oscillator that locked the event loop after resize.
    if (frame.scrollDrainPending) {
      this.drainTimer = setTimeout(() => this.onRender(), FRAME_INTERVAL_MS >> 2)
    }

    const yogaMs = getLastYogaMs()
    const commitMs = getLastCommitMs()
    const yc = this.lastYogaCounters
    // Reset so drain-only frames (no React commit) don't repeat stale values.
    resetProfileCounters()
    this.lastYogaCounters = {
      ms: 0,
      visited: 0,
      measured: 0,
      cacheHits: 0,
      live: 0
    }
    this.options.onFrame?.({
      durationMs: performance.now() - renderStart,
      phases: {
        renderer: rendererMs,
        diff: diffMs,
        optimize: optimizeMs,
        write: writeMs,
        patches: diff.length,
        optimizedPatches: optimized.length,
        writeBytes,
        backpressure,
        prevFrameDrainMs,
        yoga: yogaMs,
        commit: commitMs,
        yogaVisited: yc.visited,
        yogaMeasured: yc.measured,
        yogaCacheHits: yc.cacheHits,
        yogaLive: yc.live
      },
      flickers
    })

    this.isRendering = false

    if (this.immediateRerenderRequested) {
      this.immediateRerenderRequested = false
      queueMicrotask(() => this.onRender())
    }
  }
  pause(): void {
    // Flush pending React updates and render before pausing.
    reconciler.flushSyncFromReconciler()
    this.onRender()
    this.isPaused = true
  }
  resume(): void {
    this.isPaused = false
    this.onRender()
  }

  /**
   * Reset frame buffers so the next render writes the full screen from scratch.
   * Call this before resume() when the terminal content has been corrupted by
   * an external process (e.g. tmux, shell, full-screen TUI).
   */
  repaint(): void {
    this.frontFrame = emptyFrame(
      this.frontFrame.viewport.height,
      this.frontFrame.viewport.width,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool
    )
    this.backFrame = emptyFrame(
      this.backFrame.viewport.height,
      this.backFrame.viewport.width,
      this.stylePool,
      this.charPool,
      this.hyperlinkPool
    )
    this.log.reset()
    // Physical cursor position is unknown after external terminal corruption.
    // Clear displayCursor so the cursor preamble doesn't emit a stale
    // relative move from where we last parked it.
    this.displayCursor = null
  }

  /**
   * Clear the physical terminal and force a full redraw.
   *
   * The traditional readline ctrl+l — clears the visible screen and
   * redraws the current content. Also the recovery path when the terminal
   * was cleared externally (macOS Cmd+K) and Ink's diff engine thinks
   * unchanged cells don't need repainting. Scrollback is preserved.
   */
  forceRedraw(): void {
    if (!this.options.stdout.isTTY || this.isUnmounted || this.isPaused) {
      return
    }

    this.options.stdout.write(ERASE_SCREEN + CURSOR_HOME)

    if (this.altScreenActive) {
      this.resetFramesForAltScreen()
    } else {
      this.repaint()
      // repaint() resets frontFrame to 0×0. Without this flag the next
      // frame's blit optimization copies from that empty screen and the
      // diff sees no content. onRender resets the flag at frame end.
      this.prevFrameContaminated = true
    }

    this.onRender()
  }

  /**
   * Mark the previous frame as untrustworthy for blit, forcing the next
   * render to do a full-damage diff instead of the per-node fast path.
   *
   * Lighter than forceRedraw() — no screen clear, no extra write. Call
   * from a useLayoutEffect cleanup when unmounting a tall overlay: the
   * blit fast path can copy stale cells from the overlay frame into rows
   * the shrunken layout no longer reaches, leaving a ghost title/divider.
   * onRender resets the flag at frame end so it's one-shot.
   */
  invalidatePrevFrame(): void {
    this.prevFrameContaminated = true
  }

  /**
   * Called by the <AlternateScreen> component on mount/unmount.
   * Controls cursor.y clamping in the renderer and gates alt-screen-aware
   * behavior in SIGCONT/resize/unmount handlers. Repaints on change so
   * the first alt-screen frame (and first main-screen frame on exit) is
   * a full redraw with no stale diff state.
   */
  setAltScreenActive(active: boolean, mouseTracking: MouseTrackingMode = 'off'): void {
    if (this.altScreenActive === active) {
      return
    }

    this.altScreenActive = active
    this.altScreenMouseTracking = active ? mouseTracking : 'off'

    // Hover state is alt-screen-scoped: dispatchHover is gated on
    // altScreenActive, so once we leave the alt screen there's no path to
    // clear it on our own. Without this reset, remounting <AlternateScreen>
    // would render a phantom hover highlight from the previous session
    // until the next mouse-move event arrived. Clear both the live value
    // and the last-rendered tracker so the next onRender sees no transition
    // and no overlay.
    this.hoveredHyperlink = undefined
    this.lastRenderedHoveredHyperlink = undefined

    if (active) {
      this.resetFramesForAltScreen()
      this.scheduleRender()
    } else {
      this.repaint()
    }
  }

  /**
   * Switch mouse tracking preset at runtime while the alt screen is
   * active. Always issues DISABLE first so switching between subsets (e.g.
   * 'all' → 'wheel') clears mode 1003 instead of leaving it asserted —
   * DEC private modes have no "set this exact bitmask" form, only
   * individual set/reset, and tmux's mouse-mode bookkeeping does honor the
   * reset so the prompt-row "No image in clipboard" spam stops.
   */
  setAltScreenMouseTracking(mode: MouseTrackingMode): void {
    if (this.altScreenMouseTracking === mode) {
      return
    }

    this.altScreenMouseTracking = mode

    if (this.altScreenActive) {
      this.options.stdout.write(DISABLE_MOUSE_TRACKING + enableMouseTrackingFor(mode))
    }
  }
  get isAltScreenActive(): boolean {
    return this.altScreenActive
  }

  /**
   * True while the terminal is expected to have DEC mouse tracking armed:
   * alt screen active, not paused for an editor handoff, and the current
   * preset isn't 'off'. Gates App's mouse-mode watchdog (DECRQM probe) so
   * it never probes when tracking is intentionally disabled (/mouse off),
   * during pause (probe bytes would leak into the external editor's
   * session), or after unmount.
   */
  get expectsMouseTracking(): boolean {
    return this.altScreenActive && !this.isPaused && !this.isUnmounted && this.altScreenMouseTracking !== 'off'
  }

  /**
   * Re-assert terminal modes after a gap (>5s stdin silence or event-loop
   * stall). Catches tmux detach→attach, ssh reconnect, and laptop
   * sleep/wake — none of which send SIGCONT. The terminal may reset DEC
   * private modes on reconnect; this method restores them.
   *
   * Always re-asserts extended key reporting and mouse tracking. Mouse
   * tracking is idempotent (DEC private mode set-when-set is a no-op). The
   * Kitty keyboard protocol is NOT — CSI >1u is a stack push, so we pop
   * first to keep depth balanced (pop on empty stack is a no-op per spec,
   * so after a terminal reset this still restores depth 0→1). Without the
   * pop, each >5s idle gap adds a stack entry, and the single pop on exit
   * or suspend can't drain them — the shell is left in CSI u mode where
   * Ctrl+C/Ctrl+D leak as escape sequences. The alt-screen
   * re-entry (ERASE_SCREEN + frame reset) is NOT idempotent — it blanks the
   * screen — so it's opt-in via includeAltScreen. The stdin-gap caller fires
   * on ordinary >5s idle + keypress and must not erase; the event-loop stall
   * detector fires on genuine sleep/wake and opts in. tmux attach / ssh
   * reconnect typically send a resize, which already covers alt-screen via
   * handleResize.
   */
  reassertTerminalModes = (includeAltScreen = false): void => {
    if (!this.options.stdout.isTTY) {
      return
    }

    // Don't touch the terminal during an editor handoff — re-enabling kitty
    // keyboard here would undo enterAlternateScreen's disable and nano would
    // start seeing CSI-u sequences again.
    if (this.isPaused) {
      return
    }

    // Extended keys — re-assert if enabled (App.tsx enables these on
    // allowlisted terminals at raw-mode entry; a terminal reset clears them).
    // Pop-before-push keeps Kitty stack depth at 1 instead of accumulating
    // on each call.
    if (supportsExtendedKeys()) {
      this.options.stdout.write(
        DISABLE_KITTY_KEYBOARD + (skipKittyKeyboardProtocol() ? '' : ENABLE_KITTY_KEYBOARD) + ENABLE_MODIFY_OTHER_KEYS
      )
    }

    if (!this.altScreenActive) {
      return
    }

    // Mouse tracking — idempotent, safe to re-assert on every stdin gap.
    // DISABLE first so we land in the exact preset state even if an
    // external app or tmux left DEC 1003 hover asserted out from under us
    // since the last assertion.
    this.options.stdout.write(DISABLE_MOUSE_TRACKING + enableMouseTrackingFor(this.altScreenMouseTracking))

    // Alt-screen re-entry — destructive (ERASE_SCREEN). Only for callers that
    // have a strong signal the terminal actually dropped mode 1049.
    if (includeAltScreen) {
      this.reenterAltScreen()
    }
  }

  /**
   * Mark this instance as unmounted so future unmount() calls early-return.
   * Called by gracefulShutdown's cleanupTerminalModes() after it has sent
   * EXIT_ALT_SCREEN but before the remaining terminal-reset sequences.
   * Without this, signal-exit's deferred ink.unmount() (triggered by
   * process.exit()) runs the full unmount path: onRender() + writeSync
   * cleanup block + updateContainerSync → AlternateScreen unmount cleanup.
   * The result is 2-3 redundant EXIT_ALT_SCREEN sequences landing on the
   * main screen AFTER printResumeHint(), which tmux (at least) interprets
   * as restoring the saved cursor position — clobbering the resume hint.
   */
  detachForShutdown(): void {
    this.isUnmounted = true
    // Cancel any pending throttled render so it doesn't fire between
    // cleanupTerminalModes() and process.exit() and write to main screen.
    this.scheduleRender.cancel?.()

    // Restore stdin from raw mode. unmount() used to do this via React
    // unmount (App.componentWillUnmount → handleSetRawMode(false)) but we're
    // short-circuiting that path. Must use this.options.stdin — NOT
    // process.stdin — because getStdinOverride() may have opened /dev/tty
    // when stdin is piped.
    const stdin = this.options.stdin as NodeJS.ReadStream & {
      isRaw?: boolean
      setRawMode?: (m: boolean) => void
    }

    this.drainStdin()

    if (stdin.isTTY && stdin.isRaw && stdin.setRawMode) {
      stdin.setRawMode(false)
    }
  }

  /** @see drainStdin */
  drainStdin(): void {
    drainStdin(this.options.stdin)
  }

  /**
   * Re-enter alt-screen, clear, home, re-enable mouse tracking, and reset
   * frame buffers so the next render repaints from scratch. Self-heal for
   * SIGCONT, resize, and stdin-gap/event-loop-stall (sleep/wake) — any of
   * which can leave the terminal in main-screen mode while altScreenActive
   * stays true. ENTER_ALT_SCREEN is a terminal-side no-op if already in alt.
   */
  private reenterAltScreen(): void {
    // DISABLE_MOUSE_TRACKING before enableMouseTrackingFor — same as
    // setAltScreenMouseTracking / AlternateScreen mount / handleResize.
    // DEC private modes have no atomic "set this bitmask" sequence, only
    // per-mode set/reset, so for 'wheel'/'buttons' presets we must reset
    // first to drop any lingering DEC 1003 hover from before re-entry.
    this.options.stdout.write(
      ENTER_ALT_SCREEN +
        ERASE_SCREEN +
        CURSOR_HOME +
        DISABLE_MOUSE_TRACKING +
        enableMouseTrackingFor(this.altScreenMouseTracking)
    )
    this.resetFramesForAltScreen()
    // ERASE_SCREEN above leaves the physical alt screen blank, and
    // resetFramesForAltScreen() seeds prev/back as blank rows×cols, so
    // nothing on the front frame survives the re-entry. Callers
    // (handleResume on SIGCONT, the resize self-heal, the stdin-gap
    // re-assertion) all return early after invoking us, so without an
    // explicit render schedule the alt screen sits blank until some
    // unrelated state change fires the next commit. queueing one
    // microtask matches scheduleRender's normal cadence.
    this.scheduleRender()
  }

  /**
   * Seed prev/back frames with full-size BLANK screens (rows×cols of empty
   * cells, not 0×0). In alt-screen mode, next.screen.height is always
   * terminalRows; if prev.screen.height is 0 (emptyFrame's default),
   * log-update sees heightDelta > 0 ('growing') and calls renderFrameSlice,
   * whose trailing per-row CR+LF at the last row scrolls the alt screen,
   * permanently desyncing the virtual and physical cursors by 1 row.
   *
   * With a rows×cols blank prev, heightDelta === 0 → standard diffEach
   * → moveCursorTo (CSI cursorMove, no LF, no scroll).
   *
   * viewport.height = rows + 1 matches the renderer's alt-screen output,
   * preventing a spurious resize trigger on the first frame. cursor.y = 0
   * matches the physical cursor after ENTER_ALT_SCREEN + CSI H (home).
   */
  private resetFramesForAltScreen(): void {
    const rows = this.terminalRows
    const cols = this.terminalColumns

    const blank = (): Frame => ({
      screen: createScreen(cols, rows, this.stylePool, this.charPool, this.hyperlinkPool),
      viewport: {
        width: cols,
        height: rows + 1
      },
      cursor: {
        x: 0,
        y: 0,
        visible: true
      }
    })

    this.frontFrame = blank()
    this.backFrame = blank()
    this.log.reset()
    // Defense-in-depth: alt-screen skips the cursor preamble anyway (CSI H
    // resets), but a stale displayCursor would be misleading if we later
    // exit to main-screen without an intervening render.
    this.displayCursor = null
    // Fresh frontFrame is blank rows×cols — blitting from it would copy
    // blanks over content. Next alt-screen frame must full-render.
    this.prevFrameContaminated = true
  }

  /**
   * Copy the current text selection to the system clipboard without clearing the
   * selection. Returns the copied text when a clipboard path succeeded (native
   * tool fired, tmux buffer loaded, or OSC 52 emitted), or '' when no path was
   * taken (e.g. headless Linux without tmux). Matches iTerm2's copy-on-select
   * behavior where the selected region stays visible after the automatic copy.
   */
  async copySelectionNoClear(): Promise<string> {
    if (!hasSelection(this.selection)) {
      return ''
    }

    const text = this.getTextSelectionText()

    if (text) {
      try {
        const { sequence, success } = await setClipboard(text)

        if (sequence) {
          this.options.stdout.write(sequence)
        }

        if (success) {
          return text
        }
      } catch {
        // Clipboard failed across every path — caller sees the empty
        // return below and surfaces a hint via the slash command.
      }
    }

    return ''
  }

  getTextSelectionText(): string {
    return hasSelection(this.selection) ? getSelectedText(this.selection, this.frontFrame.screen) : ''
  }

  /**
   * Copy the current text selection to the system clipboard via OSC 52
   * and clear the selection. Returns the copied text (empty if no selection
   * or clipboard operation failed).
   */
  async copySelection(): Promise<string> {
    if (!hasSelection(this.selection)) {
      return ''
    }

    const text = await this.copySelectionNoClear()
    clearSelection(this.selection)
    this.notifySelectionChange()

    return text
  }

  /** Clear the current text selection without copying. */
  clearTextSelection(): void {
    if (!hasSelection(this.selection)) {
      return
    }

    clearSelection(this.selection)
    this.notifySelectionChange()
  }

  /**
   * Set the search highlight query. Non-empty → all visible occurrences
   * are inverted (SGR 7) on the next frame; first one also underlined.
   * Empty → clears (prevFrameContaminated handles the frame after). Same
   * damage-tracking machinery as selection — setCellStyleId doesn't track
   * damage, so the overlay forces full-frame damage while active.
   */
  setSearchHighlight(query: string): void {
    if (this.searchHighlightQuery === query) {
      return
    }

    this.searchHighlightQuery = query
    this.scheduleRender()
  }

  /** Paint an EXISTING DOM subtree to a fresh Screen at its natural
   *  height, scan for query. Returns positions relative to the element's
   *  bounding box (row 0 = element top).
   *
   *  The element comes from the MAIN tree — built with all real
   *  providers, yoga already computed. We paint it to a fresh buffer
   *  with offsets so it lands at (0,0). Same paint path as the main
   *  render. Zero drift. No second React root, no context bridge.
   *
   *  ~1-2ms (paint only, no reconcile — the DOM is already built). */
  scanElementSubtree(el: dom.DOMElement): MatchPosition[] {
    if (!this.searchHighlightQuery || !el.yogaNode) {
      return []
    }

    const width = Math.ceil(el.yogaNode.getComputedWidth())
    const height = Math.ceil(el.yogaNode.getComputedHeight())

    if (width <= 0 || height <= 0) {
      return []
    }

    // renderNodeToOutput adds el's OWN computedLeft/Top to offsetX/Y.
    // Passing -elLeft/-elTop nets to 0 → paints at (0,0) in our buffer.
    const elLeft = el.yogaNode.getComputedLeft()
    const elTop = el.yogaNode.getComputedTop()
    const screen = createScreen(width, height, this.stylePool, this.charPool, this.hyperlinkPool)

    const output = new Output({
      width,
      height,
      stylePool: this.stylePool,
      screen
    })

    renderNodeToOutput(el, output, {
      offsetX: -elLeft,
      offsetY: -elTop,
      prevScreen: undefined
    })
    const rendered = output.get()
    // renderNodeToOutput wrote our offset positions to nodeCache —
    // corrupts the main render (it'd blit from wrong coords). Mark the
    // subtree dirty so the next main render repaints + re-caches
    // correctly. One extra paint of this message, but correct > fast.
    dom.markDirty(el)
    const positions = scanPositions(rendered, this.searchHighlightQuery)
    logForDebugging(
      `scanElementSubtree: q='${this.searchHighlightQuery}' ` +
        `el=${width}x${height}@(${elLeft},${elTop}) n=${positions.length} ` +
        `[${positions
          .slice(0, 10)
          .map(p => `${p.row}:${p.col}`)
          .join(',')}` +
        `${positions.length > 10 ? ',…' : ''}]`
    )

    return positions
  }

  /** Set the position-based highlight state. Every frame, writes CURRENT
   *  style at positions[currentIdx] + rowOffset. null clears. The scan-
   *  highlight (inverse on all matches) still runs — this overlays yellow
   *  on top. rowOffset changes as the user scrolls (= message's current
   *  screen-top); positions stay stable (message-relative). */
  setSearchPositions(
    state: {
      positions: MatchPosition[]
      rowOffset: number
      currentIdx: number
    } | null
  ): void {
    this.searchPositions = state
    this.scheduleRender()
  }

  /**
   * Set the selection highlight background color. Replaces the per-cell
   * SGR-7 inverse with a solid theme-aware bg (matches native terminal
   * selection). Accepts the same color formats as Text backgroundColor
   * (rgb(), ansi:name, #hex, ansi256()) — colorize() routes through
   * chalk so the tmux/xterm.js level clamps in colorize.ts apply and
   * the emitted SGR is correct for the current terminal.
   *
   * Called by React-land once theme is known (ScrollKeybindingHandler's
   * useEffect watching useTheme). Before that call, withSelectionBg
   * falls back to withInverse so selection still renders on the first
   * frame; the effect fires before any mouse input so the fallback is
   * unobservable in practice.
   */
  setSelectionBgColor(color: string): void {
    // Wrap a NUL marker, then split on it to extract the open/close SGR.
    // colorize returns the input unchanged if the color string is bad —
    // no NUL-split then, so fall through to null (inverse fallback).
    const wrapped = colorize('\0', color, 'background')
    const nul = wrapped.indexOf('\0')

    if (nul <= 0 || nul === wrapped.length - 1) {
      this.stylePool.setSelectionBg(null)

      return
    }

    this.stylePool.setSelectionBg({
      type: 'ansi',
      code: wrapped.slice(0, nul),
      endCode: wrapped.slice(nul + 1) // always \x1b[49m for bg
    })
    // No scheduleRender: this is called from a React effect that already
    // runs inside the render cycle, and the bg only matters once a
    // selection exists (which itself triggers a full-damage frame).
  }

  /**
   * Capture text from rows about to scroll out of the viewport during
   * drag-to-scroll. Must be called BEFORE the ScrollBox scrolls so the
   * screen buffer still holds the outgoing content. Accumulated into
   * the selection state and joined back in by getSelectedText.
   */
  captureScrolledRows(firstRow: number, lastRow: number, side: 'above' | 'below'): void {
    captureScrolledRows(this.selection, this.frontFrame.screen, firstRow, lastRow, side)
  }

  /**
   * Shift anchor AND focus by dRow, clamped to [minRow, maxRow]. Used by
   * keyboard scroll handlers (PgUp/PgDn etc.) so the highlight tracks the
   * content instead of disappearing. Unlike shiftAnchor (drag-to-scroll),
   * this moves BOTH endpoints — the user isn't holding the mouse at one
   * edge. Supplies screen.width for the col-reset-on-clamp boundary.
   */
  shiftSelectionForScroll(dRow: number, minRow: number, maxRow: number): void {
    const hadSel = hasSelection(this.selection)
    shiftSelection(this.selection, dRow, minRow, maxRow, this.frontFrame.screen.width)

    // shiftSelection clears when both endpoints overshoot the same edge
    // (Home/g/End/G page-jump past the selection). Notify subscribers so
    // useHasSelection updates. Safe to call notifySelectionChange here —
    // this runs from keyboard handlers, not inside onRender().
    if (hadSel && !hasSelection(this.selection)) {
      this.notifySelectionChange()
    }
  }

  /**
   * Keyboard selection extension (shift+arrow/home/end). Moves focus;
   * anchor stays fixed so the highlight grows or shrinks relative to it.
   * Left/right wrap across row boundaries — native macOS text-edit
   * behavior: shift+left at col 0 wraps to end of the previous row.
   * Up/down clamp at viewport edges (no scroll-to-extend yet). Drops to
   * char mode. No-op outside alt-screen or without an active selection.
   */
  moveSelectionFocus(move: FocusMove): void {
    if (!this.altScreenActive) {
      return
    }

    const { focus } = this.selection

    if (!focus) {
      return
    }

    const { width, height } = this.frontFrame.screen

    const maxCol = width - 1
    const maxRow = height - 1

    let { col, row } = focus

    switch (move) {
      case 'left':
        if (col > 0) {
          col--
        } else if (row > 0) {
          col = maxCol
          row--
        }

        break

      case 'right':
        if (col < maxCol) {
          col++
        } else if (row < maxRow) {
          col = 0
          row++
        }

        break

      case 'up':
        if (row > 0) {
          row--
        }

        break

      case 'down':
        if (row < maxRow) {
          row++
        }

        break

      case 'lineStart':
        col = 0

        break

      case 'lineEnd':
        col = maxCol

        break
    }

    if (col === focus.col && row === focus.row) {
      return
    }

    moveFocus(this.selection, col, row)
    this.notifySelectionChange()
  }

  /** Whether there is an active text selection. */
  hasTextSelection(): boolean {
    return hasSelection(this.selection)
  }

  getSelectionVersion(): number {
    return this.selectionVersion
  }

  /**
   * Subscribe to selection state changes. Fires whenever the selection
   * mutates — anchor/focus moves, drag updates, programmatic clears.
   * Does NOT fire on `copySelectionNoClear()` (no mutation, no notify),
   * which is why version-based subscribers don't risk re-entrant copies.
   * Returns an unsubscribe fn.
   */
  subscribeToSelectionChange(cb: () => void): () => void {
    this.selectionListeners.add(cb)

    return () => this.selectionListeners.delete(cb)
  }
  private notifySelectionChange(): void {
    this.scheduleRender()

    // Only bump version when the selection range actually mutated.
    // Listeners still fire unconditionally — useHasSelection() snapshots
    // through React, which dedupes via Object.is on the boolean value.
    const sig = selectionSignature(this.selection)

    if (sig !== this.lastSelectionSignature) {
      this.lastSelectionSignature = sig
      this.selectionVersion += 1
    }

    for (const cb of this.selectionListeners) {
      cb()
    }
  }

  /**
   * Hit-test the rendered DOM tree at (col, row) and bubble a ClickEvent
   * from the deepest hit node up through ancestors with onClick handlers.
   * Returns true if a DOM handler consumed the click. Gated on
   * altScreenActive — clicks only make sense with a fixed viewport where
   * nodeCache rects map 1:1 to terminal cells (no scrollback offset).
   */
  dispatchClick(col: number, row: number): boolean {
    if (!this.altScreenActive) {
      return false
    }

    const blank = isEmptyCellAt(this.frontFrame.screen, col, row)

    return dispatchClick(this.rootNode, col, row, blank)
  }
  dispatchMouseDown(col: number, row: number, button: number): dom.DOMElement | undefined {
    if (!this.altScreenActive) {
      return undefined
    }

    this.stopSelectionAutoScroll()

    return dispatchMouse(
      this.rootNode,
      col,
      row,
      'onMouseDown',
      button,
      isEmptyCellAt(this.frontFrame.screen, col, row)
    )
  }
  dispatchMouseUp(target: dom.DOMElement, col: number, row: number, button: number): void {
    if (!this.altScreenActive) {
      return
    }

    this.stopSelectionAutoScroll()
    dispatchMouse(this.rootNode, col, row, 'onMouseUp', button, isEmptyCellAt(this.frontFrame.screen, col, row), target)
  }
  dispatchMouseDrag(target: dom.DOMElement, col: number, row: number, button: number): void {
    if (!this.altScreenActive) {
      return
    }

    dispatchMouse(
      this.rootNode,
      col,
      row,
      'onMouseDrag',
      button,
      isEmptyCellAt(this.frontFrame.screen, col, row),
      target
    )
  }
  dispatchHover(col: number, row: number): void {
    if (!this.altScreenActive) {
      return
    }

    dispatchHover(this.rootNode, col, row, this.hoveredNodes)

    // Hover affordance for hyperlinks: read the cell at the pointer, store
    // its URL (or clear when the pointer leaves a link), and request a
    // repaint when the value changes. The render-pass overlay paints the
    // highlight; we just track which URL is "hot".
    //
    // IMPORTANT: bypass getHyperlinkAt() here — its plain-text URL fallback
    // (findPlainTextUrlAt) would return URLs for cells whose `cell.hyperlink`
    // is undefined, which the overlay (applyHyperlinkHoverHighlight)
    // wouldn't match. That'd burn re-renders without ever producing an
    // affordance. Read the OSC 8 hyperlink directly off the cell so the
    // hover state is a 1:1 fit for what the overlay can paint. The
    // plain-text URL fallback still works for clicks; hover is a strictly
    // weaker signal and OK to skip on plain-text URLs.
    const screen = this.frontFrame.screen
    const cell = cellAt(screen, col, row)
    let next = cell?.hyperlink

    // SpacerTail (second half of a wide-char / emoji glyph) stores the
    // hyperlink on the head cell at col-1. Same logic as getHyperlinkAt.
    if (!next && cell?.width === CellWidth.SpacerTail && col > 0) {
      next = cellAt(screen, col - 1, row)?.hyperlink
    }

    if (next !== this.hoveredHyperlink) {
      this.hoveredHyperlink = next
      this.scheduleRender()
    }
  }
  dispatchKeyboardEvent(parsedKey: ParsedKey): void {
    const target = this.focusManager.activeElement ?? this.rootNode
    const event = new KeyboardEvent(parsedKey)
    dispatcher.dispatchDiscrete(target, event)

    // Tab cycling is the default action — only fires if no handler
    // called preventDefault(). Mirrors browser behavior.
    if (!event.defaultPrevented && parsedKey.name === 'tab' && !parsedKey.ctrl && !parsedKey.meta) {
      if (parsedKey.shift) {
        this.focusManager.focusPrevious(this.rootNode)
      } else {
        this.focusManager.focusNext(this.rootNode)
      }
    }
  }
  /**
   * Look up the URL at (col, row) in the current front frame. Checks for
   * an OSC 8 hyperlink first, then falls back to scanning the row for a
   * plain-text URL (mouse tracking intercepts the terminal's native
   * Cmd+Click URL detection, so we replicate it). This is a pure lookup
   * with no side effects — call it synchronously at click time so the
   * result reflects the screen the user actually clicked on, then defer
   * the browser-open action via a timer.
   */
  getHyperlinkAt(col: number, row: number): string | undefined {
    if (!this.altScreenActive) {
      return undefined
    }

    const screen = this.frontFrame.screen
    const cell = cellAt(screen, col, row)
    let url = cell?.hyperlink

    // SpacerTail cells (right half of wide/CJK/emoji chars) store the
    // hyperlink on the head cell at col-1.
    if (!url && cell?.width === CellWidth.SpacerTail && col > 0) {
      url = cellAt(screen, col - 1, row)?.hyperlink
    }

    return url ?? findPlainTextUrlAt(screen, col, row)
  }

  /**
   * Optional callback fired when clicking a cell that has an associated URL
   * in fullscreen mode. `url` may be either an OSC 8 hyperlink (from a
   * `<Link>` render or external OSC 8 escape that landed in the buffer) or
   * a plain-text URL detected on the clicked row by findPlainTextUrlAt
   * (App.tsx routes both into the same callback). Set from the host via
   * the `onHyperlinkClick` Render/Ink option, or directly on the instance
   * for late-bound test scenarios.
   */
  onHyperlinkClick: ((url: string) => void) | undefined

  /**
   * Stable prototype wrapper for onHyperlinkClick. Passed to <App> as
   * onOpenHyperlink so the prop is a bound method (autoBind'd) that reads
   * the mutable field at call time — not the undefined-at-render value.
   */
  openHyperlink(url: string): void {
    this.onHyperlinkClick?.(url)
  }

  /**
   * Handle a double- or triple-click at (col, row): select the word or
   * line under the cursor by reading the current screen buffer. Called on
   * PRESS (not release) so the highlight appears immediately and drag can
   * extend the selection word-by-word / line-by-line. Falls back to
   * char-mode startSelection if the click lands on a noSelect cell.
   */
  handleMultiClick(col: number, row: number, count: 2 | 3): void {
    if (!this.altScreenActive) {
      return
    }

    const screen = this.frontFrame.screen
    // selectWordAt/selectLineAt no-op on noSelect/out-of-bounds. Seed with
    // a char-mode selection so the press still starts a drag even if the
    // word/line scan finds nothing selectable.
    startSelection(this.selection, col, row)

    if (count === 2) {
      selectWordAt(this.selection, screen, col, row)
    } else {
      selectLineAt(this.selection, screen, row)
    }

    // Ensure hasSelection is true so release doesn't re-dispatch onClickAt.
    // selectWordAt no-ops on noSelect; selectLineAt no-ops out-of-bounds.
    if (!this.selection.focus) {
      this.selection.focus = this.selection.anchor
    }

    this.notifySelectionChange()
  }

  /**
   * Handle a drag-motion at (col, row). In char mode updates focus to the
   * exact cell. In word/line mode snaps to word/line boundaries so the
   * selection extends by word/line like native macOS. Gated on
   * altScreenActive for the same reason as dispatchClick.
   */
  handleSelectionDrag(col: number, row: number): void {
    if (!this.altScreenActive) {
      return
    }

    if (this.selectionDragCell?.col === col && this.selectionDragCell.row === row) {
      this.updateSelectionAutoScroll(row)

      return
    }

    this.selectionDragCell = { col, row }
    this.applySelectionDrag(col, row)
    this.updateSelectionAutoScroll(row)
  }

  private applySelectionDrag(col: number, row: number): void {
    const sel = this.selection

    if (sel.anchorSpan) {
      extendSelection(sel, this.frontFrame.screen, col, row)
    } else {
      updateSelection(sel, col, row)
    }

    this.notifySelectionChange()
  }

  private updateSelectionAutoScroll(row: number): void {
    if (!this.selection.isDragging || !this.altScreenActive) {
      this.stopSelectionAutoScroll()

      return
    }

    const dir: -1 | 0 | 1 = row <= 0 ? -1 : row >= this.terminalRows - 1 ? 1 : 0

    if (dir === 0) {
      this.stopSelectionAutoScroll()

      return
    }

    if (this.selectionAutoScrollDir === dir && this.selectionAutoScrollTimer) {
      return
    }

    this.stopSelectionAutoScroll()
    this.selectionAutoScrollDir = dir
    this.selectionAutoScrollTimer = setInterval(() => this.stepSelectionAutoScroll(), 50)
  }

  private stepSelectionAutoScroll(): void {
    if (!this.selection.isDragging || !this.altScreenActive || this.selectionAutoScrollDir === 0) {
      this.stopSelectionAutoScroll()

      return
    }

    const box = this.findPrimaryScrollBox()

    if (!box) {
      this.stopSelectionAutoScroll()

      return
    }

    const viewport = Math.max(0, box.scrollViewportHeight ?? 0)
    const max = Math.max(0, (box.scrollHeight ?? 0) - viewport)
    const current = box.scrollTop ?? 0
    const next = Math.max(0, Math.min(max, current + this.selectionAutoScrollDir))

    if (next === current) {
      return
    }

    const top = box.scrollViewportTop ?? 0
    const bottom = top + viewport - 1
    const before = selectionBounds(this.selection)

    if (before) {
      if (this.selectionAutoScrollDir > 0) {
        captureScrolledRows(this.selection, this.frontFrame.screen, top, top, 'above')
      } else {
        captureScrolledRows(this.selection, this.frontFrame.screen, bottom, bottom, 'below')
      }
    }

    box.stickyScroll = false
    box.pendingScrollDelta = undefined
    box.scrollAnchor = undefined
    box.scrollTop = next
    markDirty(box)
    shiftAnchor(this.selection, -this.selectionAutoScrollDir, top, bottom)

    if (this.selectionDragCell) {
      this.selectionDragCell = {
        col: this.selectionDragCell.col,
        row: this.selectionAutoScrollDir > 0 ? bottom : top
      }
    }

    this.applySelectionDrag(
      this.selectionDragCell?.col ?? 0,
      this.selectionDragCell?.row ?? (this.selectionAutoScrollDir > 0 ? bottom : top)
    )
  }

  private stopSelectionAutoScroll(): void {
    if (this.selectionAutoScrollTimer) {
      clearInterval(this.selectionAutoScrollTimer)
      this.selectionAutoScrollTimer = null
    }

    this.selectionAutoScrollDir = 0
    this.selectionDragCell = null
  }

  private findPrimaryScrollBox(): dom.DOMElement | undefined {
    const stack = [this.rootNode]

    while (stack.length) {
      const node = stack.shift()!

      if (
        node.style.overflowY === 'scroll' &&
        node.scrollHeight !== undefined &&
        node.scrollViewportHeight !== undefined
      ) {
        return node
      }

      for (const child of node.childNodes) {
        if (child.nodeName !== '#text') {
          stack.push(child)
        }
      }
    }
  }

  // Methods to properly suspend stdin for external editor usage
  // This is needed to prevent Ink from swallowing keystrokes when an external editor is active
  private stdinListeners: Array<{
    event: string
    listener: (...args: unknown[]) => void
  }> = []
  private wasRawMode = false
  suspendStdin(): void {
    const stdin = this.options.stdin

    if (!stdin.isTTY) {
      return
    }

    // Store and remove all 'readable' event listeners temporarily
    // This prevents Ink from consuming stdin while the editor is active
    const readableListeners = stdin.listeners('readable')
    logForDebugging(
      `[stdin] suspendStdin: removing ${readableListeners.length} readable listener(s), wasRawMode=${
        (
          stdin as NodeJS.ReadStream & {
            isRaw?: boolean
          }
        ).isRaw ?? false
      }`
    )
    readableListeners.forEach(listener => {
      this.stdinListeners.push({
        event: 'readable',
        listener: listener as (...args: unknown[]) => void
      })
      stdin.removeListener('readable', listener as (...args: unknown[]) => void)
    })

    // If raw mode is enabled, disable it temporarily
    const stdinWithRaw = stdin as NodeJS.ReadStream & {
      isRaw?: boolean
      setRawMode?: (mode: boolean) => void
    }

    if (stdinWithRaw.isRaw && stdinWithRaw.setRawMode) {
      stdinWithRaw.setRawMode(false)
      this.wasRawMode = true
    }
  }
  resumeStdin(): void {
    const stdin = this.options.stdin

    if (!stdin.isTTY) {
      return
    }

    // Re-attach all the stored listeners
    if (this.stdinListeners.length === 0 && !this.wasRawMode) {
      logForDebugging('[stdin] resumeStdin: called with no stored listeners and wasRawMode=false (possible desync)', {
        level: 'warn'
      })
    }

    logForDebugging(
      `[stdin] resumeStdin: re-attaching ${this.stdinListeners.length} listener(s), wasRawMode=${this.wasRawMode}`
    )
    this.stdinListeners.forEach(({ event, listener }) => {
      stdin.addListener(event, listener)
    })
    this.stdinListeners = []

    // Re-enable raw mode if it was enabled before
    if (this.wasRawMode) {
      const stdinWithRaw = stdin as NodeJS.ReadStream & {
        setRawMode?: (mode: boolean) => void
      }

      if (stdinWithRaw.setRawMode) {
        stdinWithRaw.setRawMode(true)
      }

      this.wasRawMode = false
    }
  }

  // Stable identity for TerminalWriteContext. An inline arrow here would
  // change on every render() call (initial mount + each resize), which
  // cascades through useContext → <AlternateScreen>'s useLayoutEffect dep
  // array → spurious exit+re-enter of the alt screen on every SIGWINCH.
  private writeRaw(data: string): void {
    this.options.stdout.write(data)
  }
  private setCursorDeclaration: CursorDeclarationSetter = (decl, clearIfNode) => {
    if (decl === null && clearIfNode !== undefined && this.cursorDeclaration?.node !== clearIfNode) {
      return
    }

    this.cursorDeclaration = decl
  }
  // Caller writes raw bytes to stdout that move the physical terminal
  // cursor (e.g. TextInput's fast-echo bypass). Without this notification,
  // Ink's `displayCursor` cache and log-update's prevFrame.cursor stay
  // unchanged, so the next frame's relative cursor moves compute from a
  // stale position and the hardware cursor parks `dx` cells offset from
  // the actual caret. Visible symptom: extra whitespace between the just-
  // typed character and the cursor block, more pronounced on long
  // sessions where unrelated components re-render between fast-echo and
  // the deferred composer re-render.
  //
  // If displayCursor was already tracked, just bump it. Otherwise seed it
  // to (prevFrame.cursor + delta) so the next frame's preamble emits a
  // (-dx, -dy) relative move that brings the cursor back to log-update's
  // expected start position before the diff body runs.
  //
  // Public so tests can drive it directly without mounting App.
  //
  // Bumps BOTH `displayCursor` (used by log-update's relative-move
  // preamble) AND, if non-null, `cursorDeclaration.relativeX/Y` (the
  // target the cursor parks at after every frame). Advancing only one
  // of the two would leave the other stale: e.g. if the deferred React
  // `setCur` hasn't flushed yet, the next unrelated re-render would
  // re-compute `target` from the stale declaration and park the
  // hardware cursor back at the old caret column. We advance both so
  // the fast-echo is invisible to intervening frames until React
  // catches up.
  noteExternalCursorAdvance: CursorAdvanceNotifier = (dx, dy = 0) => {
    if (dx === 0 && dy === 0) {
      return
    }

    // displayCursor / log-update relative-move basis only matters on
    // main screen — alt-screen frames begin with absolute CSI H every
    // frame so the next preamble naturally resets to (0,0). cursorDeclaration,
    // however, IS still consulted on alt-screen — onRender's park branch
    // emits an absolute CUP using `rect.x + decl.relativeX`, so a stale
    // declaration in the deferred-setCur window would park the cursor
    // at the pre-keystroke caret. We therefore skip ONLY the displayCursor
    // half on alt-screen, not the declaration half.
    if (!this.altScreenActive) {
      if (this.displayCursor !== null) {
        this.displayCursor = {
          x: this.displayCursor.x + dx,
          y: this.displayCursor.y + dy
        }
      } else {
        // No prior parked position. Seed from frontFrame.cursor (where
        // log-update parked the cursor at the end of the last frame) so
        // the next preamble's relative move correctly cancels the
        // external advance.
        const baseX = this.frontFrame.cursor.x
        const baseY = this.frontFrame.cursor.y
        this.displayCursor = { x: baseX + dx, y: baseY + dy }
      }
    }

    // Also advance the active cursor declaration if any. Without this,
    // a TextInput that defers its React `cur` state update (16ms timer
    // in textInput.tsx — perf optimization that batches re-renders
    // during heavy typing) leaves `cursorDeclaration.relativeX` pointing
    // at the pre-keystroke caret column. If an unrelated component
    // re-renders before the deferred `setCur` flushes, the cursor-park
    // branch at the end of onRender would move the hardware cursor back
    // to that stale relativeX and visually undo the fast-echo's
    // advance. Bumping relativeX here keeps the declared target in
    // lock-step with the physical cursor until React state catches up.
    // Applies to BOTH main-screen and alt-screen — the alt-screen park
    // branch uses an absolute CUP to (rect.x + decl.relativeX), so a
    // stale declaration there would still produce the wrong column.
    const decl = this.cursorDeclaration

    if (decl !== null) {
      this.cursorDeclaration = {
        node: decl.node,
        relativeX: decl.relativeX + dx,
        relativeY: decl.relativeY + dy
      }
    }
  }
  render(node: ReactNode): void {
    this.currentNode = node

    const tree = (
      <App
        dispatchKeyboardEvent={this.dispatchKeyboardEvent}
        exitOnCtrlC={this.options.exitOnCtrlC}
        getHyperlinkAt={this.getHyperlinkAt}
        getSelectedText={this.getTextSelectionText}
        onClickAt={this.dispatchClick}
        onCopySelectionNoClear={this.copySelectionNoClear}
        onCursorAdvance={this.noteExternalCursorAdvance}
        onCursorDeclaration={this.setCursorDeclaration}
        onExit={this.unmount}
        onHoverAt={this.dispatchHover}
        onMouseDownAt={this.dispatchMouseDown}
        onMouseDragAt={this.dispatchMouseDrag}
        onMouseUpAt={this.dispatchMouseUp}
        onMultiClick={this.handleMultiClick}
        onOpenHyperlink={this.openHyperlink}
        onSelectionChange={this.notifySelectionChange}
        onSelectionDrag={this.handleSelectionDrag}
        onStdinResume={this.reassertTerminalModes}
        onTerminalFocusChange={this.handleTerminalFocusChange}
        selection={this.selection}
        stderr={this.options.stderr}
        stdin={this.options.stdin}
        stdout={this.options.stdout}
        terminalColumns={this.terminalColumns}
        terminalRows={this.terminalRows}
      >
        <TerminalWriteProvider value={this.writeRaw}>{node}</TerminalWriteProvider>
      </App>
    )

    reconciler.updateContainerSync(tree, this.container, null, noop)
    reconciler.flushSyncWork()
  }
  unmount(error?: Error | number | null): void {
    if (this.isUnmounted) {
      return
    }

    this.onRender()
    this.unsubscribeExit()

    if (typeof this.restoreConsole === 'function') {
      this.restoreConsole()
    }

    this.restoreStderr?.()
    this.unsubscribeTTYHandlers?.()

    // Non-TTY environments don't handle erasing ansi escapes well, so it's better to
    // only render last frame of non-static output
    const diff = this.log.renderPreviousOutput_DEPRECATED(this.frontFrame)
    writeDiffToTerminal(this.terminal, optimize(diff))

    // Clean up terminal modes synchronously before process exit.
    // React's componentWillUnmount won't run in time when process.exit() is called,
    // so we must reset terminal modes here to prevent escape sequence leakage.
    // Use writeSync to stdout (fd 1) to ensure writes complete before exit.
    // We unconditionally send all disable sequences because terminal detection
    // may not work correctly (e.g., in tmux, screen) and these are no-ops on
    // terminals that don't support them.

    if (this.options.stdout.isTTY) {
      if (this.altScreenActive) {
        // <AlternateScreen>'s unmount effect won't run during signal-exit.
        // Exit alt screen FIRST so other cleanup sequences go to the main screen.
        writeSync(1, EXIT_ALT_SCREEN)
      }

      // Disable mouse tracking — unconditional because altScreenActive can be
      // stale if AlternateScreen's unmount (which flips the flag) raced a
      // blocked event loop + SIGINT. No-op if tracking was never enabled.
      writeSync(1, DISABLE_MOUSE_TRACKING)
      // Drain stdin so in-flight mouse events don't leak to the shell
      this.drainStdin()
      // Disable extended key reporting (both kitty and modifyOtherKeys)
      writeSync(1, DISABLE_MODIFY_OTHER_KEYS)
      writeSync(1, DISABLE_KITTY_KEYBOARD)
      // Disable focus events (DECSET 1004)
      writeSync(1, DFE)
      // Disable bracketed paste mode
      writeSync(1, DBP)
      // Show cursor
      writeSync(1, SHOW_CURSOR)
      // Clear iTerm2 progress bar
      writeSync(1, CLEAR_ITERM2_PROGRESS)

      // Clear tab status (OSC 21337) so a stale dot doesn't linger
      if (supportsTabStatus()) {
        writeSync(1, wrapForMultiplexer(CLEAR_TAB_STATUS))
      }
    }

    this.isUnmounted = true

    // Cancel any pending throttled renders to prevent accessing freed Yoga nodes
    this.scheduleRender.cancel?.()

    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer)
      this.drainTimer = null
    }

    if (this.resizeSettleTimer !== null) {
      clearTimeout(this.resizeSettleTimer)
      this.resizeSettleTimer = null
    }

    reconciler.updateContainerSync(null, this.container, null, noop)
    reconciler.flushSyncWork()
    instances.delete(this.options.stdout)

    // Free the root yoga node, then clear its reference. Children are already
    // freed by the reconciler's removeChildFromContainer; using .free() (not
    // .freeRecursive()) avoids double-freeing them.
    this.rootNode.yogaNode?.free()
    this.rootNode.yogaNode = undefined

    if (error instanceof Error) {
      this.rejectExitPromise(error)
    } else {
      this.resolveExitPromise()
    }
  }
  async waitUntilExit(): Promise<void> {
    this.exitPromise ||= new Promise((resolve, reject) => {
      this.resolveExitPromise = resolve
      this.rejectExitPromise = reject
    })

    return this.exitPromise
  }
  resetLineCount(): void {
    if (this.options.stdout.isTTY) {
      // Swap so old front becomes back (for screen reuse), then reset front
      this.backFrame = this.frontFrame
      this.frontFrame = emptyFrame(
        this.frontFrame.viewport.height,
        this.frontFrame.viewport.width,
        this.stylePool,
        this.charPool,
        this.hyperlinkPool
      )
      this.log.reset()
      // frontFrame is reset, so frame.cursor on the next render is (0,0).
      // Clear displayCursor so the preamble doesn't compute a stale delta.
      this.displayCursor = null
    }
  }

  /**
   * Replace char/hyperlink pools with fresh instances to prevent unbounded
   * growth during long sessions. Migrates the front frame's screen IDs into
   * the new pools so diffing remains correct. The back frame doesn't need
   * migration — resetScreen zeros it before any reads.
   *
   * Call between conversation turns or periodically.
   */
  resetPools(): void {
    this.charPool = new CharPool()
    this.hyperlinkPool = new HyperlinkPool()
    migrateScreenPools(this.frontFrame.screen, this.charPool, this.hyperlinkPool)
    // Back frame's data is zeroed by resetScreen before reads, but its pool
    // references are used by the renderer to intern new characters. Point
    // them at the new pools so the next frame's IDs are comparable.
    this.backFrame.screen.charPool = this.charPool
    this.backFrame.screen.hyperlinkPool = this.hyperlinkPool
  }
  patchConsole(): () => void {
    // biome-ignore lint/suspicious/noConsole: intentionally patching global console
    const con = console
    const originals: Partial<Record<keyof Console, Console[keyof Console]>> = {}
    const toDebug = (...args: unknown[]) => logForDebugging(`console.log: ${format(...args)}`)
    const toError = (...args: unknown[]) => logError(new Error(`console.error: ${format(...args)}`))

    for (const m of CONSOLE_STDOUT_METHODS) {
      originals[m] = con[m]
      con[m] = toDebug
    }

    for (const m of CONSOLE_STDERR_METHODS) {
      originals[m] = con[m]
      con[m] = toError
    }

    originals.assert = con.assert

    con.assert = (condition: unknown, ...args: unknown[]) => {
      if (!condition) {
        toError(...args)
      }
    }

    return () => Object.assign(con, originals)
  }

  /**
   * Intercept process.stderr.write so stray writes (config.ts, hooks.ts,
   * third-party deps) don't corrupt the alt-screen buffer. patchConsole only
   * hooks console.* methods — direct stderr writes bypass it, land at the
   * parked cursor, scroll the alt-screen, and desync frontFrame from the
   * physical terminal. Next diff writes only changed-in-React cells at
   * absolute coords → interleaved garbage.
   *
   * Swallows the write (routes text to the debug log) and, in alt-screen,
   * forces a full-damage repaint as a defensive recovery. Not patching
   * process.stdout — Ink itself writes there.
   */
  private patchStderr(): () => void {
    const stderr = process.stderr
    const originalWrite = stderr.write
    let reentered = false

    const intercept = (
      chunk: Uint8Array | string,
      encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
      cb?: (err?: Error | null) => void
    ): boolean => {
      const callback = typeof encodingOrCb === 'function' ? encodingOrCb : cb

      // Reentrancy guard: logForDebugging → writeToStderr → here. Pass
      // through to the original so --debug-to-stderr still works and we
      // don't stack-overflow.
      if (reentered) {
        const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : undefined

        return originalWrite.call(stderr, chunk, encoding, callback)
      }

      reentered = true

      try {
        const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        logForDebugging(`[stderr] ${text}`, {
          level: 'warn'
        })

        if (this.altScreenActive && !this.isUnmounted && !this.isPaused) {
          this.prevFrameContaminated = true
          this.scheduleRender()
        }
      } finally {
        reentered = false
        callback?.()
      }

      return true
    }

    stderr.write = intercept

    return () => {
      if (stderr.write === intercept) {
        stderr.write = originalWrite
      }
    }
  }
}

/**
 * Discard pending stdin bytes so in-flight escape sequences (mouse tracking
 * reports, bracketed-paste markers) don't leak to the shell after exit.
 *
 * Two layers of trickiness:
 *
 * 1. setRawMode is termios, not fcntl — the stdin fd stays blocking, so
 *    readSync on it would hang forever. Node doesn't expose fcntl, so we
 *    open /dev/tty fresh with O_NONBLOCK (all fds to the controlling
 *    terminal share one line-discipline input queue).
 *
 * 2. By the time forceExit calls this, detachForShutdown has already put
 *    the TTY back in cooked (canonical) mode. Canonical mode line-buffers
 *    input until newline, so O_NONBLOCK reads return EAGAIN even when
 *    mouse bytes are sitting in the buffer. We briefly re-enter raw mode
 *    so reads return any available bytes, then restore cooked mode.
 *
 * Safe to call multiple times. Call as LATE as possible in the exit path:
 * DISABLE_MOUSE_TRACKING has terminal round-trip latency, so events can
 * arrive for a few ms after it's written.
 */

export function drainStdin(stdin: NodeJS.ReadStream = process.stdin): void {
  if (!stdin.isTTY) {
    return
  }

  // Drain Node's stream buffer (bytes libuv already pulled in). read()
  // returns null when empty — never blocks.
  try {
    while (stdin.read() !== null) {
      /* discard */
    }
  } catch {
    /* stream may be destroyed */
  }

  // No /dev/tty on Windows; CONIN$ doesn't support O_NONBLOCK semantics.
  // Windows Terminal also doesn't buffer mouse reports the same way.
  if (process.platform === 'win32') {
    return
  }

  // termios is per-device: flip stdin to raw so canonical-mode line
  // buffering doesn't hide partial input from the non-blocking read.
  // Restored in the finally block.
  const tty = stdin as NodeJS.ReadStream & {
    isRaw?: boolean
    setRawMode?: (raw: boolean) => void
  }

  const wasRaw = tty.isRaw === true
  // Drain the kernel TTY buffer via a fresh O_NONBLOCK fd. Bounded at 64
  // reads (64KB) — a real mouse burst is a few hundred bytes; the cap
  // guards against a terminal that ignores O_NONBLOCK.
  let fd = -1

  try {
    // setRawMode inside try: on revoked TTY (SIGHUP/SSH disconnect) the
    // ioctl throws EBADF — same recovery path as openSync/readSync below.
    if (!wasRaw) {
      tty.setRawMode?.(true)
    }

    fd = openSync('/dev/tty', fsConstants.O_RDONLY | fsConstants.O_NONBLOCK)
    const buf = Buffer.alloc(1024)

    for (let i = 0; i < 64; i++) {
      if (readSync(fd, buf, 0, buf.length, null) <= 0) {
        break
      }
    }
  } catch {
    // EAGAIN (buffer empty — expected), ENXIO/ENOENT (no controlling tty),
    // EBADF/EIO (TTY revoked — SIGHUP, SSH disconnect)
  } finally {
    if (fd >= 0) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }

    if (!wasRaw) {
      try {
        tty.setRawMode?.(false)
      } catch {
        /* TTY may be gone */
      }
    }
  }
}

const CONSOLE_STDOUT_METHODS = [
  'log',
  'info',
  'debug',
  'dir',
  'dirxml',
  'count',
  'countReset',
  'group',
  'groupCollapsed',
  'groupEnd',
  'table',
  'time',
  'timeEnd',
  'timeLog'
] as const

const CONSOLE_STDERR_METHODS = ['warn', 'error', 'trace'] as const
