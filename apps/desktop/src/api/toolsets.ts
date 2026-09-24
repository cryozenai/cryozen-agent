import type {
  ActionResponse,
  ComputerUseStatus,
  TerminalBackendsResponse,
  ToolsetConfig,
  ToolsetInfo,
  ToolsetModelsResponse
} from '@/types/cryozen'

import { capabilityScoped, cryozenApi, type ProfileScope, profileScoped } from './client'

// The optional trailing `profile` on every capability fetcher below is the
// Capabilities view's profile-scope override: it lets the Skills/Tools/MCP
// panels configure ANY profile without swapping the app-wide active profile.
// Omitting it (every pre-existing caller) means `profileScoped(undefined)`
// falls back to the app-wide `_apiProfile`, so behavior is byte-identical.
export function getToolsets(profile?: ProfileScope): Promise<ToolsetInfo[]> {
  return window.cryozenDesktop.api<ToolsetInfo[]>({
    ...capabilityScoped(profile),
    path: '/api/tools/toolsets'
  })
}

export function setToolsetEnabled(
  name: string,
  enabled: boolean,
  profile?: ProfileScope
): Promise<{ ok: boolean; name: string; enabled: boolean }> {
  return window.cryozenDesktop.api<{ ok: boolean; name: string; enabled: boolean }>({
    ...capabilityScoped(profile),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}`,
    method: 'PUT',
    body: { enabled }
  })
}

export function getToolsetConfig(name: string, profile?: ProfileScope): Promise<ToolsetConfig> {
  return window.cryozenDesktop.api<ToolsetConfig>({
    ...capabilityScoped(profile),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}/config`
  })
}

export function getToolsetModels(
  name: string,
  provider?: string,
  profile?: ProfileScope
): Promise<ToolsetModelsResponse> {
  const suffix = provider ? `?provider=${encodeURIComponent(provider)}` : ''

  return window.cryozenDesktop.api<ToolsetModelsResponse>({
    ...capabilityScoped(profile),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}/models${suffix}`
  })
}

export function selectToolsetModel(
  name: string,
  model: string,
  provider?: string,
  profile?: ProfileScope
): Promise<{ ok: boolean; name: string; model: string }> {
  return window.cryozenDesktop.api<{ ok: boolean; name: string; model: string }>({
    ...capabilityScoped(profile),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}/model`,
    method: 'PUT',
    body: { model, provider }
  })
}

export interface SelectToolsetProviderResponse {
  ok: boolean
  name: string
  provider: string
  /** Present when the selection was scoped to one web capability. */
  capability?: string
}

export function selectToolsetProvider(
  name: string,
  provider: string,
  capability?: 'search' | 'extract',
  profile?: ProfileScope
): Promise<SelectToolsetProviderResponse> {
  return window.cryozenDesktop.api<SelectToolsetProviderResponse>({
    ...capabilityScoped(profile),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}/provider`,
    method: 'PUT',
    body: capability ? { provider, capability } : { provider }
  })
}

export function runToolsetPostSetup(
  name: string,
  key: string,
  profile?: ProfileScope
): Promise<ActionResponse & { key: string }> {
  return window.cryozenDesktop.api<ActionResponse & { key: string }>({
    ...capabilityScoped(profile),
    path: `/api/tools/toolsets/${encodeURIComponent(name)}/post-setup`,
    method: 'POST',
    body: { key }
  })
}

export function getTerminalBackends(): Promise<TerminalBackendsResponse> {
  return cryozenApi<TerminalBackendsResponse>({
    ...profileScoped(),
    path: '/api/tools/terminal/backends'
  })
}

export function selectTerminalBackend(backend: string): Promise<{ ok: boolean; backend: string }> {
  return cryozenApi<{ ok: boolean; backend: string }>({
    ...profileScoped(),
    path: '/api/tools/terminal/backend',
    method: 'PUT',
    body: { backend }
  })
}

export function getComputerUseStatus(): Promise<ComputerUseStatus> {
  return cryozenApi<ComputerUseStatus>({
    ...profileScoped(),
    path: '/api/tools/computer-use/status'
  })
}

export function grantComputerUsePermissions(): Promise<ActionResponse> {
  return cryozenApi<ActionResponse>({
    ...profileScoped(),
    path: '/api/tools/computer-use/permissions/grant',
    method: 'POST'
  })
}
