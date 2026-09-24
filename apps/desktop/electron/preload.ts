import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron'

import type { DesktopProfileRoute } from './desktop-profile'
import type { HudModifierApi, HudModifierStatus } from './hud-modifier-types'
import { customWindowControlsEnabled } from './window-controls'

// Which translucency the OS can back. Asked synchronously because the renderer
// needs it before its first paint, and answered by main because deciding it
// needs `os.release()` — a sandboxed preload may only require electron, events,
// timers and url, so importing node:os here throws before contextBridge runs
// and takes the ENTIRE bridge down with it (window.cryozenDesktop undefined =>
// "Desktop IPC bridge is unavailable"). No reply means no glass, which degrades
// to an ordinary opaque window rather than a page thinned over nothing.
const translucencySupport = ipcRenderer.sendSync('cryozen:translucency:support')
const hudWindowing = ipcRenderer.sendSync('cryozen:hud:windowing')
const hudNativeDrag = hudWindowing?.nativeDrag === true
const launchFlags = ipcRenderer.sendSync('cryozen:launch-flags')

contextBridge.exposeInMainWorld('cryozenDesktop', {
  glassSupported: translucencySupport?.glass === true,
  translucencySupported: translucencySupport?.translucency === true,
  // Launch-flag fact: the app was started with --local, so the renderer may
  // show the local-models surfaces. Static for the window's lifetime.
  localModelsEnabled: launchFlags?.localModels === true,
  getConnection: (profile, opts) => ipcRenderer.invoke('cryozen:connection', profile, opts),
  // Registry-scoped backend resolution: { connectionId, profile } → descriptor.
  getConnectionFor: payload => ipcRenderer.invoke('cryozen:connection:for', payload),
  getProfileRoutes: profiles => ipcRenderer.invoke('cryozen:plugin-profile-routes', profiles),
  revalidateConnection: () => ipcRenderer.invoke('cryozen:connection:revalidate'),
  touchBackend: (profile, options) => ipcRenderer.invoke('cryozen:backend:touch', profile, options),
  getPoolLimits: () => ipcRenderer.invoke('cryozen:pool-limits:get'),
  setPoolLimits: limits => ipcRenderer.invoke('cryozen:pool-limits:set', limits),
  getGatewayWsUrl: profile => ipcRenderer.invoke('cryozen:gateway:ws-url', profile),
  // Registry-scoped fresh WS URL: { connectionId, profile } → result shape of
  // getGatewayWsUrl, minted against that connection's backend.
  getGatewayWsUrlFor: payload => ipcRenderer.invoke('cryozen:gateway:ws-url-for', payload),
  // Union agent roster across every registered connection.
  getAgentRoster: () => ipcRenderer.invoke('cryozen:agents:roster'),
  openSessionWindow: (sessionId, opts) => ipcRenderer.invoke('cryozen:window:openSession', sessionId, opts),
  openSessionInTerminal: (sessionId, opts) => ipcRenderer.invoke('cryozen:window:openInTerminal', sessionId, opts),
  openWindow: (options?: DesktopProfileRoute) => ipcRenderer.invoke('cryozen:window:openInstance', options),
  openBrowserWindow: tabId => ipcRenderer.invoke('cryozen:window:openBrowser', tabId),
  onBrowserPopoutClosed: callback => {
    const listener = (_event, tabId) => callback(tabId)
    ipcRenderer.on('cryozen:browser-popout:closed', listener)

    return () => ipcRenderer.removeListener('cryozen:browser-popout:closed', listener)
  },
  claimAmbientCue: key => ipcRenderer.invoke('cryozen:ambient:claim', key),
  windowControls: {
    custom: customWindowControlsEnabled(),
    minimize: () => ipcRenderer.send('cryozen:window-control', 'minimize'),
    toggleMaximize: () => ipcRenderer.send('cryozen:window-control', 'toggle-maximize'),
    close: () => ipcRenderer.send('cryozen:window-control', 'close')
  },
  wakeIndicator: {
    getState: () => ipcRenderer.invoke('cryozen:wake-indicator:get'),
    setState: state => ipcRenderer.send('cryozen:wake-indicator:set', state),
    onState: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('cryozen:wake-indicator:state', listener)

      return () => ipcRenderer.removeListener('cryozen:wake-indicator:state', listener)
    }
  },
  petOverlay: {
    // Main renderer → main process: window lifecycle + drag. `request` is
    // `{ bounds, screen }`; resolves with the screen bounds it actually used.
    open: request => ipcRenderer.invoke('cryozen:pet-overlay:open', request),
    close: () => ipcRenderer.invoke('cryozen:pet-overlay:close'),
    setBounds: bounds => ipcRenderer.send('cryozen:pet-overlay:set-bounds', bounds),
    setIgnoreMouse: ignore => ipcRenderer.send('cryozen:pet-overlay:ignore-mouse', ignore),
    // Flip the overlay focusable (and focus it) while the composer needs keys.
    setFocusable: focusable => ipcRenderer.send('cryozen:pet-overlay:set-focusable', focusable),
    // Main renderer → overlay (forwarded by main): push the latest pet state.
    pushState: payload => ipcRenderer.send('cryozen:pet-overlay:state', payload),
    // Overlay → main renderer (forwarded by main): pop back in / composer submit.
    control: payload => ipcRenderer.send('cryozen:pet-overlay:control', payload),
    // Overlay subscribes to state pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('cryozen:pet-overlay:state', listener)

      return () => ipcRenderer.removeListener('cryozen:pet-overlay:state', listener)
    },
    // Main renderer subscribes to overlay control messages.
    onControl: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('cryozen:pet-overlay:control', listener)

      return () => ipcRenderer.removeListener('cryozen:pet-overlay:control', listener)
    }
  },
  // HUD mode: the chrome-free floating chat. A full app renderer (own gateway)
  // sized as a floating bar, so it mounts the real composer. Main owns the
  // window; `onChanged` keeps every window's toggle truthful.
  hud: {
    nativeDrag: hudNativeDrag,
    windowing: {
      clientPlacement: hudWindowing?.clientPlacement !== false,
      controlDrag: hudWindowing?.controlDrag === true,
      nativeDrag: hudNativeDrag,
      solid: hudWindowing?.solid === true,
      workspaceTransfer: hudWindowing?.workspaceTransfer === true
    },
    open: request => ipcRenderer.invoke('cryozen:hud:open', request),
    close: () => ipcRenderer.invoke('cryozen:hud:close'),
    setIgnoreMouse: ignore => ipcRenderer.send('cryozen:hud:ignore-mouse', ignore),
    beginMove: () => ipcRenderer.send('cryozen:hud:begin-move'),
    endMove: () => ipcRenderer.send('cryozen:hud:end-move'),
    moveBy: delta => ipcRenderer.send('cryozen:hud:move-by', delta),
    setWorkspaceTransfer: transferring => ipcRenderer.send('cryozen:hud:workspace-transfer', transferring),
    setBounds: bounds => ipcRenderer.send('cryozen:hud:set-bounds', bounds),
    resetLayout: () => ipcRenderer.invoke('cryozen:hud:reset-layout'),
    // Whether the band covers the window below the bar. Main pairs it with the
    // user's translucency setting to decide the native frost (macOS vibrancy /
    // Windows 11 DWM backdrop) — see hudFrostFor.
    setFrost: showing => ipcRenderer.invoke('cryozen:hud:frost', showing),
    // The HUD tells main which session it is on; main hands that back to the
    // app window when the HUD closes, so the app can re-home onto it.
    setSession: sessionId => ipcRenderer.send('cryozen:hud:session', sessionId),
    onGoto: callback => {
      const listener = (_event, sessionId) => callback(sessionId)
      ipcRenderer.on('cryozen:hud:goto', listener)

      return () => ipcRenderer.removeListener('cryozen:hud:goto', listener)
    },
    onChanged: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('cryozen:hud:changed', listener)

      return () => ipcRenderer.removeListener('cryozen:hud:changed', listener)
    },
    // Linux only, and silent elsewhere: where the cursor is, in page
    // coordinates, or null when it has left the window. Stands in for the
    // mousemove that `setIgnoreMouseEvents(true, { forward: true })` delivers on
    // macOS and Windows but not here.
    onCursor: callback => {
      const listener = (_event, point) => callback(point)
      ipcRenderer.on('cryozen:hud:cursor', listener)

      return () => ipcRenderer.removeListener('cryozen:hud:cursor', listener)
    },
    // Main's game-overlay watch: whether a fullscreen app (a game) is under
    // the HUD, so the renderer can step back to the low-opacity overlay
    // treatment while one owns the screen.
    onGameOverlay: callback => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('cryozen:hud:game-overlay', listener)

      return () => ipcRenderer.removeListener('cryozen:hud:game-overlay', listener)
    }
  },
  hudModifier: {
    getSettings: () => ipcRenderer.invoke('cryozen:hud-modifier:settings:get'),
    setEnabled: enabled => ipcRenderer.invoke('cryozen:hud-modifier:settings:set', enabled),
    openPermissionSettings: () => ipcRenderer.invoke('cryozen:hud-modifier:permission'),
    onStatus: callback => {
      const listener = (_event: Electron.IpcRendererEvent, status: HudModifierStatus) => callback(status)
      ipcRenderer.on('cryozen:hud-modifier:status', listener)

      return () => ipcRenderer.removeListener('cryozen:hud-modifier:status', listener)
    }
  } satisfies HudModifierApi,
  // macOS native screenshot gesture; captures require a main-issued request.
  screenshot:
    process.platform === 'darwin'
      ? {
          getSettings: () => ipcRenderer.invoke('cryozen:screenshot:settings:get'),
          setEnabled: enabled => ipcRenderer.invoke('cryozen:screenshot:settings:set', enabled),
          openPermissionSettings: kind => ipcRenderer.invoke('cryozen:screenshot:permission', kind),
          capture: requestId => ipcRenderer.invoke('cryozen:screenshot:capture', requestId),
          onStatus: callback => {
            const listener = (_event, status) => callback(status)
            ipcRenderer.on('cryozen:screenshot:status', listener)

            return () => ipcRenderer.removeListener('cryozen:screenshot:status', listener)
          },
          onRequest: callback => {
            const channel = 'cryozen:screenshot:request'
            const listener = (_event, requestId) => callback(requestId)

            if (ipcRenderer.listenerCount(channel) === 0) {
              ipcRenderer.send('cryozen:screenshot:subscribe', true)
            }

            ipcRenderer.on(channel, listener)

            return () => {
              ipcRenderer.removeListener(channel, listener)

              if (ipcRenderer.listenerCount(channel) === 0) {
                ipcRenderer.send('cryozen:screenshot:subscribe', false)
              }
            }
          }
        }
      : undefined,
  // Quick Entry: the global-hotkey mini composer window. Main owns the OS
  // shortcut + the persisted preference; the quick window only captures text
  // and hands it back, and the primary renderer submits it through the normal
  // prompt path.
  quickEntry: {
    getSettings: () => ipcRenderer.invoke('cryozen:quick-entry:settings:get'),
    setSettings: patch => ipcRenderer.invoke('cryozen:quick-entry:settings:set', patch),
    submit: payload => ipcRenderer.send('cryozen:quick-entry:submit', payload),
    dismiss: () => ipcRenderer.send('cryozen:quick-entry:dismiss'),
    // Primary renderer → main → quick window: gateway connection state + the
    // recent-session options the target picker offers. Main caches the latest
    // payload so a freshly spawned quick window starts from truth.
    pushState: payload => ipcRenderer.send('cryozen:quick-entry:state', payload),
    // Quick window subscribes to those pushes.
    onState: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('cryozen:quick-entry:state', listener)

      return () => ipcRenderer.removeListener('cryozen:quick-entry:state', listener)
    },
    // Main → primary renderer: a submit captured by the quick window.
    onSubmit: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('cryozen:quick-entry:submit', listener)

      return () => ipcRenderer.removeListener('cryozen:quick-entry:submit', listener)
    },
    // Main → quick window: you were just summoned (reset draft + refocus).
    onShown: callback => {
      const listener = () => callback()
      ipcRenderer.on('cryozen:quick-entry:shown', listener)

      return () => ipcRenderer.removeListener('cryozen:quick-entry:shown', listener)
    }
  },
  getBootProgress: () => ipcRenderer.invoke('cryozen:boot-progress:get'),
  getConnectionConfig: profile => ipcRenderer.invoke('cryozen:connection-config:get', profile),
  saveConnectionConfig: payload => ipcRenderer.invoke('cryozen:connection-config:save', payload),
  applyConnectionConfig: payload => ipcRenderer.invoke('cryozen:connection-config:apply', payload),
  testConnectionConfig: payload => ipcRenderer.invoke('cryozen:connection-config:test', payload),
  // Opt-in OS-keychain encryption for stored gateway secrets (default off —
  // see secret-storage-policy.ts). get never touches the OS keychain.
  getSecretStorageEncryption: () => ipcRenderer.invoke('cryozen:secret-storage:get'),
  setSecretStorageEncryption: (on: boolean) => ipcRenderer.invoke('cryozen:secret-storage:set', on),
  // v2 multi-connection registry: named agent sources (local / remote / ssh).
  connections: {
    list: () => ipcRenderer.invoke('cryozen:connections:list'),
    save: payload => ipcRenderer.invoke('cryozen:connections:save', payload),
    remove: id => ipcRenderer.invoke('cryozen:connections:remove', id),
    setPrimary: id => ipcRenderer.invoke('cryozen:connections:set-primary', id),
    setLaunchMode: mode => ipcRenderer.invoke('cryozen:connections:set-launch-mode', mode),
    setLastUsed: id => ipcRenderer.invoke('cryozen:connections:set-last-used', id),
    test: id => ipcRenderer.invoke('cryozen:connections:test', id),
    updateManaged: id => ipcRenderer.invoke('cryozen:connections:update-managed', id),
    // Fan out `cryozen update` to every eligible registered connection.
    // Optional excludeIds skips rows the caller updates through another path.
    updateAll: options => ipcRenderer.invoke('cryozen:connections:update-all', options),
    // Registry lifecycle push (main → renderer): a connection was removed or
    // materially edited, so secondaries scoped to it must be disposed (and,
    // for edits, re-dialed at the new target).
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('cryozen:connections:changed', listener)

      return () => ipcRenderer.removeListener('cryozen:connections:changed', listener)
    }
  },
  sshConfigHosts: () => ipcRenderer.invoke('cryozen:ssh-config:hosts'),
  sshResolveHost: host => ipcRenderer.invoke('cryozen:ssh-config:resolve', host),
  probeConnectionConfig: remoteUrl => ipcRenderer.invoke('cryozen:connection-config:probe', remoteUrl),
  oauthLoginConnectionConfig: remoteUrl => ipcRenderer.invoke('cryozen:connection-config:oauth-login', remoteUrl),
  oauthLogoutConnectionConfig: remoteUrl => ipcRenderer.invoke('cryozen:connection-config:oauth-logout', remoteUrl),
  profile: {
    getDefault: () => ipcRenderer.invoke('cryozen:profile:default:get'),
    setDefault: (route: DesktopProfileRoute) => ipcRenderer.invoke('cryozen:profile:default:set', route),
    onDefaultChanged: (callback: (route: DesktopProfileRoute | null) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, route: DesktopProfileRoute | null) => callback(route)
      ipcRenderer.on('cryozen:profile:default:changed', listener)

      return () => ipcRenderer.removeListener('cryozen:profile:default:changed', listener)
    },
    get: () => ipcRenderer.invoke('cryozen:profile:get'),
    remember: name => ipcRenderer.invoke('cryozen:profile:remember', name),
    set: name => ipcRenderer.invoke('cryozen:profile:set', name)
  },
  api: request => ipcRenderer.invoke('cryozen:api', request),
  notify: payload => ipcRenderer.invoke('cryozen:notify', payload),
  requestMicrophoneAccess: () => ipcRenderer.invoke('cryozen:requestMicrophoneAccess'),
  readWindowBelow: () => ipcRenderer.invoke('cryozen:window:readBelow'),
  readFileDataUrl: filePath => ipcRenderer.invoke('cryozen:readFileDataUrl', filePath),
  readFileDataUrlForAttach: filePath => ipcRenderer.invoke('cryozen:readFileDataUrlForAttach', filePath),
  dataUrlReadMax: {
    get: () => ipcRenderer.invoke('cryozen:data-url-read-max:get'),
    set: maxMb => ipcRenderer.invoke('cryozen:data-url-read-max:set', maxMb)
  },
  readFileText: filePath => ipcRenderer.invoke('cryozen:readFileText', filePath),
  readPluginSource: (filePath: string) => ipcRenderer.invoke('cryozen:readPluginSource', filePath),
  selectPaths: options => ipcRenderer.invoke('cryozen:selectPaths', options),
  selectSavePath: options => ipcRenderer.invoke('cryozen:selectSavePath', options),
  writeClipboard: text => ipcRenderer.invoke('cryozen:writeClipboard', text),
  readClipboard: () => ipcRenderer.invoke('cryozen:readClipboard'),
  saveGatewayFile: payload => ipcRenderer.invoke('cryozen:saveGatewayFile', payload),
  saveImageFromUrl: url => ipcRenderer.invoke('cryozen:saveImageFromUrl', url),
  contextMenuEdit: command => ipcRenderer.invoke('cryozen:context-menu:edit', command),
  contextMenuCopyImage: () => ipcRenderer.invoke('cryozen:context-menu:copy-image'),
  contextMenuSpellcheck: action => ipcRenderer.invoke('cryozen:context-menu:spellcheck', action),
  contextMenuGuestAddWord: payload => ipcRenderer.invoke('cryozen:context-menu:guest-add-word', payload),
  onContextMenuSpellcheck: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:context-menu-spellcheck', listener)

    return () => ipcRenderer.removeListener('cryozen:context-menu-spellcheck', listener)
  },
  saveImageBuffer: (data, ext, name) => ipcRenderer.invoke('cryozen:saveImageBuffer', { data, ext, name }),
  capturePreview: payload => ipcRenderer.invoke('cryozen:capturePreview', payload),
  savePastedText: text => ipcRenderer.invoke('cryozen:savePastedText', { text }),
  saveClipboardImage: () => ipcRenderer.invoke('cryozen:saveClipboardImage'),
  getPathForFile: file => {
    try {
      return webUtils.getPathForFile(file) || ''
    } catch {
      return ''
    }
  },
  normalizePreviewTarget: (target, baseDir) => ipcRenderer.invoke('cryozen:normalizePreviewTarget', target, baseDir),
  watchPreviewFile: url => ipcRenderer.invoke('cryozen:watchPreviewFile', url),
  watchDirectory: dir => ipcRenderer.invoke('cryozen:watchDirectory', dir),
  stopPreviewFileWatch: id => ipcRenderer.invoke('cryozen:stopPreviewFileWatch', id),
  setActiveWork: payload => ipcRenderer.send('cryozen:active-work', payload),
  setTitleBarTheme: payload => ipcRenderer.send('cryozen:titlebar-theme', payload),
  setNativeTheme: mode => ipcRenderer.send('cryozen:native-theme', mode),
  setTranslucency: payload => ipcRenderer.send('cryozen:translucency', payload),
  setKeepAwake: on => ipcRenderer.send('cryozen:keep-awake', on),
  minimizeToTray: {
    get: () => ipcRenderer.invoke('cryozen:minimize-to-tray:get'),
    set: on => ipcRenderer.invoke('cryozen:minimize-to-tray:set', on),
    onChanged: callback => {
      const listener = (_event, status) => callback(status)
      ipcRenderer.on('cryozen:minimize-to-tray:changed', listener)

      return () => ipcRenderer.removeListener('cryozen:minimize-to-tray:changed', listener)
    }
  },
  setDisableF12: blocked => ipcRenderer.send('cryozen:devtools:disable-f12', blocked),
  setPreviewShortcutActive: active => ipcRenderer.send('cryozen:previewShortcutActive', Boolean(active)),
  openExternal: url => ipcRenderer.invoke('cryozen:openExternal', url),
  mcpOauth: {
    // One-shot loopback listener for MCP OAuth against remote backends: bind
    // on this machine, hand redirectUri to mcp.servers.oauth.start, then wait
    // for the provider redirect and relay code/state via oauth.callback.
    listen: () => ipcRenderer.invoke('cryozen:mcp-oauth:listen'),
    wait: (id, timeoutMs) => ipcRenderer.invoke('cryozen:mcp-oauth:wait', id, timeoutMs),
    cancel: id => ipcRenderer.invoke('cryozen:mcp-oauth:cancel', id)
  },
  openPreviewInBrowser: url => ipcRenderer.invoke('cryozen:openPreviewInBrowser', url),
  reachPreviewUrl: url => ipcRenderer.invoke('cryozen:preview:reach', url),
  setActiveConnectionRoute: route => ipcRenderer.send('cryozen:connection:active-route', route),
  fetchLinkTitle: url => ipcRenderer.invoke('cryozen:fetchLinkTitle', url),
  resolveFavicon: url => ipcRenderer.invoke('cryozen:resolveFavicon', url),
  sanitizeWorkspaceCwd: cwd => ipcRenderer.invoke('cryozen:workspace:sanitize', cwd),
  settings: {
    getDefaultProjectDir: () => ipcRenderer.invoke('cryozen:setting:defaultProjectDir:get'),
    setDefaultProjectDir: dir => ipcRenderer.invoke('cryozen:setting:defaultProjectDir:set', dir),
    pickDefaultProjectDir: () => ipcRenderer.invoke('cryozen:setting:defaultProjectDir:pick')
  },
  zoom: {
    // Current zoom of this window, as { level, percent }.
    get: () => ipcRenderer.invoke('cryozen:zoom:get'),
    // Synchronous zoom factor (1 = 100%). Coordinate math needs it in the
    // same tick as the event it converts, so no IPC round-trip here.
    factor: () => webFrame.getZoomFactor(),
    setPercent: percent => ipcRenderer.send('cryozen:zoom:set-percent', percent),
    // Fires on every zoom change, including the Ctrl/Cmd +/-/0 shortcuts,
    // so the settings UI can stay in sync with the keyboard.
    onChanged: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('cryozen:zoom:changed', listener)

      return () => ipcRenderer.removeListener('cryozen:zoom:changed', listener)
    }
  },
  revealLogs: () => ipcRenderer.invoke('cryozen:logs:reveal'),
  getRecentLogs: () => ipcRenderer.invoke('cryozen:logs:recent'),
  // Fire-and-forget: persists a renderer error-boundary catch (with component
  // stack) to desktop.log so crashes survive the window (#79428).
  reportRendererError: report => ipcRenderer.send('cryozen:logs:renderer-error', report),
  readDir: dirPath => ipcRenderer.invoke('cryozen:fs:readDir', dirPath),
  gitRoot: startPath => ipcRenderer.invoke('cryozen:fs:gitRoot', startPath),
  revealPath: targetPath => ipcRenderer.invoke('cryozen:fs:reveal', targetPath),
  openDir: dirPath => ipcRenderer.invoke('cryozen:fs:openDir', dirPath),
  desktopPluginsRoot: () => ipcRenderer.invoke('cryozen:fs:desktopPluginsRoot'),
  reconcileDesktopPlugins: () => ipcRenderer.invoke('cryozen:fs:reconcileDesktopPlugins'),
  logsRoot: () => ipcRenderer.invoke('cryozen:fs:logsRoot'),
  renamePath: (targetPath, newName) => ipcRenderer.invoke('cryozen:fs:rename', targetPath, newName),
  writeTextFile: (filePath, content) => ipcRenderer.invoke('cryozen:fs:writeText', filePath, content),
  trashPath: targetPath => ipcRenderer.invoke('cryozen:fs:trash', targetPath),
  git: {
    worktreeList: repoPath => ipcRenderer.invoke('cryozen:git:worktreeList', repoPath),
    worktreeAdd: (repoPath, options) => ipcRenderer.invoke('cryozen:git:worktreeAdd', repoPath, options),
    worktreeRemove: (repoPath, worktreePath, options) =>
      ipcRenderer.invoke('cryozen:git:worktreeRemove', repoPath, worktreePath, options),
    branchSwitch: (repoPath, branch) => ipcRenderer.invoke('cryozen:git:branchSwitch', repoPath, branch),
    branchList: repoPath => ipcRenderer.invoke('cryozen:git:branchList', repoPath),
    baseBranchList: repoPath => ipcRenderer.invoke('cryozen:git:baseBranchList', repoPath),
    repoStatus: repoPath => ipcRenderer.invoke('cryozen:git:repoStatus', repoPath),
    fileDiff: (repoPath, filePath) => ipcRenderer.invoke('cryozen:git:fileDiff', repoPath, filePath),
    scanRepos: (roots, options) => ipcRenderer.invoke('cryozen:git:scanRepos', roots, options),
    review: {
      list: (repoPath, scope, baseRef) => ipcRenderer.invoke('cryozen:git:review:list', repoPath, scope, baseRef),
      diff: (repoPath, filePath, scope, baseRef, staged) =>
        ipcRenderer.invoke('cryozen:git:review:diff', repoPath, filePath, scope, baseRef, staged),
      stage: (repoPath, filePath) => ipcRenderer.invoke('cryozen:git:review:stage', repoPath, filePath),
      unstage: (repoPath, filePath) => ipcRenderer.invoke('cryozen:git:review:unstage', repoPath, filePath),
      revert: (repoPath, filePath) => ipcRenderer.invoke('cryozen:git:review:revert', repoPath, filePath),
      revParse: (repoPath, ref) => ipcRenderer.invoke('cryozen:git:review:revParse', repoPath, ref),
      commit: (repoPath, message, push) => ipcRenderer.invoke('cryozen:git:review:commit', repoPath, message, push),
      commitContext: repoPath => ipcRenderer.invoke('cryozen:git:review:commitContext', repoPath),
      push: repoPath => ipcRenderer.invoke('cryozen:git:review:push', repoPath),
      shipInfo: repoPath => ipcRenderer.invoke('cryozen:git:review:shipInfo', repoPath),
      prList: (repoPath, branches, numbers) =>
        ipcRenderer.invoke('cryozen:git:review:prList', repoPath, branches, numbers),
      createPr: repoPath => ipcRenderer.invoke('cryozen:git:review:createPr', repoPath)
    }
  },
  terminal: {
    attach: id => ipcRenderer.invoke('cryozen:terminal:attach', id),
    cwd: id => ipcRenderer.invoke('cryozen:terminal:cwd', id),
    dispose: id => ipcRenderer.invoke('cryozen:terminal:dispose', id),
    resize: (id, size) => ipcRenderer.invoke('cryozen:terminal:resize', id, size),
    start: options => ipcRenderer.invoke('cryozen:terminal:start', options),
    write: (id, data) => ipcRenderer.invoke('cryozen:terminal:write', id, data),
    onData: (id, callback) => {
      const channel = `cryozen:terminal:${id}:data`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    },
    onExit: (id, callback) => {
      const channel = `cryozen:terminal:${id}:exit`
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on(channel, listener)

      return () => ipcRenderer.removeListener(channel, listener)
    }
  },
  onClosePreviewRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('cryozen:close-preview-requested', listener)

    return () => ipcRenderer.removeListener('cryozen:close-preview-requested', listener)
  },
  onPreviewNav: callback => {
    const listener = (_event, command) => callback(command)
    ipcRenderer.on('cryozen:preview-nav', listener)

    return () => ipcRenderer.removeListener('cryozen:preview-nav', listener)
  },
  onOpenFolderRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('cryozen:open-folder-requested', listener)

    return () => ipcRenderer.removeListener('cryozen:open-folder-requested', listener)
  },
  onOpenUpdatesRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('cryozen:open-updates', listener)

    return () => ipcRenderer.removeListener('cryozen:open-updates', listener)
  },
  onDeepLink: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:deep-link', listener)

    return () => ipcRenderer.removeListener('cryozen:deep-link', listener)
  },
  signalDeepLinkReady: () => ipcRenderer.invoke('cryozen:deep-link-ready'),
  probePluginRepo: payload => ipcRenderer.invoke('cryozen:plugin:probe', payload),
  installDesktopPlugin: payload => ipcRenderer.invoke('cryozen:plugin:installDesktop', payload),
  removeDesktopPlugin: payload => ipcRenderer.invoke('cryozen:plugin:removeDesktop', payload),
  onWindowStateChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:window-state-changed', listener)

    return () => ipcRenderer.removeListener('cryozen:window-state-changed', listener)
  },
  onFocusSession: callback => {
    const listener = (_event, sessionId) => callback(sessionId)
    ipcRenderer.on('cryozen:focus-session', listener)

    return () => ipcRenderer.removeListener('cryozen:focus-session', listener)
  },
  onNotificationAction: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:notification-action', listener)

    return () => ipcRenderer.removeListener('cryozen:notification-action', listener)
  },
  onNotificationActivate: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:notification-activate', listener)

    return () => ipcRenderer.removeListener('cryozen:notification-activate', listener)
  },
  onPreviewFileChanged: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:preview-file-changed', listener)

    return () => ipcRenderer.removeListener('cryozen:preview-file-changed', listener)
  },
  onBackendExit: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:backend-exit', listener)

    return () => ipcRenderer.removeListener('cryozen:backend-exit', listener)
  },
  // Cooperative pool retirement (main → renderer): the pooled backend under
  // `poolKey` is being stopped for a foreground open. Park that scope; do not
  // redial into the slot it vacated.
  onPoolBackendRetiring: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:pool:retiring', listener)

    return () => ipcRenderer.removeListener('cryozen:pool:retiring', listener)
  },
  // Soft gateway-mode apply finished tearing down the primary backend. Renderer
  // should wipe session lists + re-dial without a window reload.
  onConnectionApplied: callback => {
    const listener = () => callback()
    ipcRenderer.on('cryozen:connection:applied', listener)

    return () => ipcRenderer.removeListener('cryozen:connection:applied', listener)
  },
  onPowerResume: callback => {
    const listener = () => callback()
    ipcRenderer.on('cryozen:power-resume', listener)

    return () => ipcRenderer.removeListener('cryozen:power-resume', listener)
  },
  // AC ↔ battery transitions; renderers slow their backstop polls on battery.
  getOnBattery: () => ipcRenderer.invoke('cryozen:power-battery:get'),
  onBatteryChanged: callback => {
    const listener = (_event, onBattery) => callback(Boolean(onBattery))
    ipcRenderer.on('cryozen:power-battery', listener)

    return () => ipcRenderer.removeListener('cryozen:power-battery', listener)
  },
  onBootProgress: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:boot-progress', listener)

    return () => ipcRenderer.removeListener('cryozen:boot-progress', listener)
  },
  // First-launch bootstrap progress -- emitted by the install.ps1 stage
  // runner in main.ts (apps/desktop/electron/bootstrap-runner.ts).
  // Renderer's install overlay subscribes to live events and queries the
  // current snapshot via getBootstrapState() to recover after a devtools
  // reload mid-bootstrap.
  getBootstrapState: () => ipcRenderer.invoke('cryozen:bootstrap:get'),
  continueBootstrapLocal: () => ipcRenderer.invoke('cryozen:bootstrap:continue-local'),
  recycleBackend: profile => ipcRenderer.invoke('cryozen:backend:recycle', profile),
  resetBootstrap: () => ipcRenderer.invoke('cryozen:bootstrap:reset'),
  repairBootstrap: () => ipcRenderer.invoke('cryozen:bootstrap:repair'),
  cancelBootstrap: () => ipcRenderer.invoke('cryozen:bootstrap:cancel'),
  onBootstrapEvent: callback => {
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('cryozen:bootstrap:event', listener)

    return () => ipcRenderer.removeListener('cryozen:bootstrap:event', listener)
  },
  getVersion: () => ipcRenderer.invoke('cryozen:version'),
  relaunchApp: () => ipcRenderer.invoke('cryozen:app:relaunch'),
  getMachineProfile: () => ipcRenderer.invoke('cryozen:machine:profile'),
  getRemoteDisplayReason: () => ipcRenderer.invoke('cryozen:get-remote-display-reason'),
  uninstall: {
    summary: () => ipcRenderer.invoke('cryozen:uninstall:summary'),
    run: mode => ipcRenderer.invoke('cryozen:uninstall:run', { mode })
  },
  updates: {
    check: opts => ipcRenderer.invoke('cryozen:updates:check', opts),
    apply: opts => ipcRenderer.invoke('cryozen:updates:apply', opts),
    getBranch: () => ipcRenderer.invoke('cryozen:updates:branch:get'),
    setBranch: name => ipcRenderer.invoke('cryozen:updates:branch:set', name),
    onProgress: callback => {
      const listener = (_event, payload) => callback(payload)
      ipcRenderer.on('cryozen:updates:progress', listener)

      return () => ipcRenderer.removeListener('cryozen:updates:progress', listener)
    }
  },
  themes: {
    fetchMarketplace: id => ipcRenderer.invoke('cryozen:vscode-theme:fetch', id),
    searchMarketplace: query => ipcRenderer.invoke('cryozen:vscode-theme:search', query)
  },
  // Find-in-page (Ctrl/Cmd+F): delegates to Electron's
  // webContents.findInPage on the IPC sender's window so a Cmd+F pressed
  // in a secondary session window searches THAT window, not the primary.
  // `onFoundInPage` returns the unsubscribe fn; the renderer wires it via
  // `initFindInPageListener` in store/find-in-page.ts and tears it down
  // when the FindBar unmounts.
  findInPage: (query, options) => ipcRenderer.invoke('cryozen:find-in-page', query, options),
  stopFindInPage: () => ipcRenderer.invoke('cryozen:stop-find-in-page'),
  onFoundInPage: callback => {
    const listener = (_event, result) => callback(result)
    ipcRenderer.on('cryozen:found-in-page', listener)

    return () => ipcRenderer.removeListener('cryozen:found-in-page', listener)
  },
  // Main-process `before-input-event` forwards Ctrl/Cmd+F here so renderer
  // can open the FindBar even when the GTK compositor has already grabbed
  // the chord at the windowing layer (#81727).
  onOpenFindBarRequested: callback => {
    const listener = () => callback()
    ipcRenderer.on('cryozen:open-find-bar', listener)

    return () => ipcRenderer.removeListener('cryozen:open-find-bar', listener)
  }
})
