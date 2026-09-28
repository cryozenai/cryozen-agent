import { EventEmitter } from 'events'

import React from 'react'
import { describe, expect, it } from 'vitest'

import Box from './components/Box.js'
import Text from './components/Text.js'
import { useDeclaredCursor } from './hooks/use-declared-cursor.js'
import Ink from './ink.js'

class FakeTty extends EventEmitter {
  chunks: string[] = []
  columns = 40
  rows = 20
  isTTY = true

  write(chunk: string | Uint8Array, cb?: (err?: Error | null) => void): boolean {
    this.chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'))
    cb?.()

    return true
  }
}

type InkPrivate = {
  displayCursor: { x: number; y: number } | null
  frontFrame: { cursor: { x: number; y: number } }
}
const peek = (ink: Ink): InkPrivate => ink as unknown as InkPrivate

// Applies the relative cursor motion in `bytes` (CUU/CUD/CUF/CUB/CHA, CR,
// LF) to `from`. Everything else is treated as zero-width.
function replayCursor(bytes: string, from: { x: number; y: number }) {
  const pos = { ...from }
  const re = /\x1b\[(\d*)([ABCDG])|\r|\n|\x1b\[[0-9;?<>=]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|./gs

  for (const m of bytes.matchAll(re)) {
    const n = m[1] ? Number(m[1]) : 1

    switch (m[2] ?? m[0]) {
      case 'A':
        pos.y -= n

        break
      case 'B':
        pos.y += n

        break
      case 'C':
        pos.x += n

        break
      case 'D':
        pos.x -= n

        break
      case 'G':
        pos.x = n - 1

        break
      case '\r':
        pos.x = 0

        break
      case '\n':
        pos.y += 1

        break
    }
  }

  return pos
}

function Composer() {
  const ref = useDeclaredCursor({ line: 0, column: 2, active: true })

  return React.createElement(Box, { ref }, React.createElement(Text, null, '> '))
}

// Main-screen (native/inline) mode parks the physical cursor at the composer
// caret. Whatever runs after exit (the Python session summary) prints from
// the physical cursor, so unmount must leave it below the last frame, not on
// the composer row with overlays still drawn underneath it.
describe('Ink.unmount on the main screen', () => {
  it('leaves the cursor below the last frame when a declared cursor was parked above it', () => {
    const stdout = new FakeTty()

    const ink = new Ink({
      exitOnCtrlC: false,
      patchConsole: false,
      stderr: new FakeTty() as unknown as NodeJS.WriteStream,
      stdin: new FakeTty() as unknown as NodeJS.ReadStream,
      stdout: stdout as unknown as NodeJS.WriteStream
    })

    ink.render(
      React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Composer),
        React.createElement(Text, null, '/quit  exit the session'),
        React.createElement(Text, null, '/queue queue a prompt')
      )
    )
    ink.onRender()

    const parked = peek(ink).displayCursor
    const { x, y } = peek(ink).frontFrame.cursor
    const bottom = { x, y }

    expect(parked).not.toBeNull()
    expect(parked!.y).toBeLessThan(bottom.y)

    const before = stdout.chunks.length
    ink.unmount()

    expect(replayCursor(stdout.chunks.slice(before).join(''), parked!)).toEqual(bottom)
  })
})
