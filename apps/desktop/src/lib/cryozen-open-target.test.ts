import { describe, expect, it } from 'vitest'

import {
  normalizeCryozenOpenString,
  pathFromCryozenDeepLink,
  pathFromOpenDeepLink,
  resolveCryozenOpenPath
} from './cryozen-open-target'

describe('normalizeCryozenOpenString', () => {
  it('accepts hash-router paths and strips a leading hash', () => {
    expect(normalizeCryozenOpenString('/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeCryozenOpenString('#/index-network/intent/1')).toBe('/index-network/intent/1')
  })

  it('maps plugin-scoped cryozen:// deep links to the same path', () => {
    expect(normalizeCryozenOpenString('cryozen://index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeCryozenOpenString('cryozen://index-network/intent/1?focus=true')).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('maps cryozen://open/… deep links by stripping the open host', () => {
    expect(normalizeCryozenOpenString('cryozen://open/index-network/intent/1')).toBe('/index-network/intent/1')
    expect(normalizeCryozenOpenString('cryozen://open/settings/plugins')).toBe('/settings/plugins')
  })

  it('rejects reserved cryozen kinds and unsafe paths', () => {
    expect(normalizeCryozenOpenString('cryozen://blueprint/morning-brief')).toBeNull()
    expect(normalizeCryozenOpenString('cryozen://plugin/install')).toBeNull()
    expect(normalizeCryozenOpenString('https://example.com/x')).toBeNull()
    expect(normalizeCryozenOpenString('/../etc/passwd')).toBeNull()
    expect(normalizeCryozenOpenString('index-network')).toBeNull()
  })
})

describe('resolveCryozenOpenPath', () => {
  it('merges structured path + params', () => {
    expect(resolveCryozenOpenPath({ path: '/index-network/intent/1', params: { focus: 'true' } })).toBe(
      '/index-network/intent/1?focus=true'
    )
  })

  it('resolves href the same as a bare string', () => {
    expect(resolveCryozenOpenPath({ href: 'cryozen://index-network/intent/1' })).toBe('/index-network/intent/1')
  })
})

describe('pathFromCryozenDeepLink', () => {
  it('builds the navigate path from a plugin-scoped deep-link payload', () => {
    expect(pathFromCryozenDeepLink('index-network', 'intent/1')).toBe('/index-network/intent/1')
  })

  it('builds the navigate path from cryozen://open/… payloads', () => {
    expect(pathFromOpenDeepLink('index-network/intent/1')).toBe('/index-network/intent/1')
    expect(pathFromCryozenDeepLink('open', 'agent/42')).toBe('/agent/42')
  })

  it('ignores reserved kinds', () => {
    expect(pathFromCryozenDeepLink('blueprint', 'morning-brief')).toBeNull()
    expect(pathFromCryozenDeepLink('plugin', 'install')).toBeNull()
  })
})
