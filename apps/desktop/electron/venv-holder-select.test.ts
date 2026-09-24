import assert from 'node:assert/strict'

import { test } from 'vitest'

import { hasWindowsPathPrefix, isCryozenOwnedVenvDaemon } from './venv-holder-select'

const SCRIPTS = 'C:\\Cryozen\\venv\\Scripts'

test('matches the hindsight daemon shim (exe under venv Scripts + hindsight cmdline)', () => {
  assert.equal(
    isCryozenOwnedVenvDaemon(
      'C:\\Cryozen\\venv\\Scripts\\pythonw.exe',
      'C:\\Cryozen\\venv\\Scripts\\pythonw.exe -m hindsight_api.main --daemon --idle-timeout 300 --port 9177',
      SCRIPTS
    ),
    true
  )
})

test('Windows path prefix match is ordinal case-insensitive', () => {
  assert.equal(
    isCryozenOwnedVenvDaemon(
      'c:\\cryozen\\venv\\scripts\\python.exe',
      'python.exe -m hindsight_api.main --daemon',
      'C:\\Cryozen\\venv\\Scripts'
    ),
    true
  )
})

test('excludes external venv holders that are not the hindsight daemon', () => {
  // a user terminal running the cryozen CLI from the venv — must NOT be killed
  assert.equal(isCryozenOwnedVenvDaemon('C:\\Cryozen\\venv\\Scripts\\cryozen.exe', 'cryozen chat -q "hi"', SCRIPTS), false)
  // an unrelated python script using the venv interpreter
  assert.equal(
    isCryozenOwnedVenvDaemon('C:\\Cryozen\\venv\\Scripts\\python.exe', 'python C:\\tools\\import.py', SCRIPTS),
    false
  )
})

test('excludes exes outside the venv even when the cmdline mentions hindsight', () => {
  assert.equal(
    isCryozenOwnedVenvDaemon('C:\\Other\\pythonw.exe', 'pythonw -m hindsight_api.main --daemon', SCRIPTS),
    false
  )
})

test('prefix boundary: sibling dirs (ScriptsX) do not match', () => {
  assert.equal(hasWindowsPathPrefix('C:\\Cryozen\\venv\\ScriptsX\\python.exe', SCRIPTS), false)
  assert.equal(hasWindowsPathPrefix('C:\\Cryozen\\venv\\Scripts\\python.exe', SCRIPTS), true)
})

test('null/undefined fields never match', () => {
  assert.equal(isCryozenOwnedVenvDaemon(null, 'x', SCRIPTS), false)
  assert.equal(isCryozenOwnedVenvDaemon('C:\\Cryozen\\venv\\Scripts\\pythonw.exe', null, SCRIPTS), false)
  assert.equal(isCryozenOwnedVenvDaemon(undefined, undefined, SCRIPTS), false)
})
