import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildMinimalProcessEnv,
  ControlledProcessError,
  getProcessTerminationStrategy,
  runControlledProcess,
} from './process-runner'

const tempDirectories: string[] = []

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

function createRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bloomai-process-runner-'))
  tempDirectories.push(root)
  return root
}

describe('controlled process runner', () => {
  it('passes command and args without shell expansion and uses an approved cwd', async () => {
    const root = createRoot()
    const result = await runControlledProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write(process.argv[1])', 'hello; echo not-a-second-command'],
      cwd: root,
      allowedRoots: [root],
      timeoutMs: 2_000,
    })

    expect(result.stdout).toBe('hello; echo not-a-second-command')
    expect(result.args).toEqual(['-e', 'process.stdout.write(process.argv[1])', 'hello; echo not-a-second-command'])
    expect(result.cwd).toBe(fs.realpathSync(root))
    expect(result.exitCode).toBe(0)
    expect(result.exited).toBe(true)
  })

  it('rejects a cwd outside the approved roots before spawning', async () => {
    const root = createRoot()
    const outside = createRoot()

    await expect(runControlledProcess({
      command: process.execPath,
      cwd: outside,
      allowedRoots: [root],
    })).rejects.toMatchObject({
      code: 'PROCESS_CWD_DENIED',
    })
  })

  it('terminates a timed out process and reports a structured timeout', async () => {
    const root = createRoot()

    const error = await runControlledProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: root,
      allowedRoots: [root],
      timeoutMs: 50,
      killGraceMs: 50,
    }).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(ControlledProcessError)
    expect(error).toMatchObject({
      code: 'PROCESS_TIMEOUT',
      result: {
        error: { code: 'PROCESS_TIMEOUT' },
        exited: true,
      },
    })
  })

  it('terminates an aborted process and leaves no live child according to the close result', async () => {
    const root = createRoot()
    const controller = new AbortController()
    const pending = runControlledProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      cwd: root,
      allowedRoots: [root],
      signal: controller.signal,
      timeoutMs: 2_000,
      killGraceMs: 50,
    }).catch((value: unknown) => value)

    await new Promise((resolve) => setTimeout(resolve, 25))
    controller.abort()
    const error = await pending

    expect(error).toBeInstanceOf(ControlledProcessError)
    expect(error).toMatchObject({
      code: 'PROCESS_CANCELLED',
      result: {
        error: { code: 'PROCESS_CANCELLED' },
        exited: true,
      },
    })
  })

  it('bounds stdout and stderr and reports truncation instead of buffering unbounded output', async () => {
    const root = createRoot()
    const error = await runControlledProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(100000)); process.stderr.write("y".repeat(100000))'],
      cwd: root,
      allowedRoots: [root],
      maxStdoutBytes: 128,
      maxStderrBytes: 128,
      timeoutMs: 2_000,
      killGraceMs: 50,
    }).catch((value: unknown) => value)

    expect(error).toBeInstanceOf(ControlledProcessError)
    expect(error).toMatchObject({
      code: 'PROCESS_OUTPUT_LIMIT',
      result: {
        stdoutTruncated: true,
        stderrTruncated: true,
        exited: true,
      },
    })
    expect((error as ControlledProcessError).result?.stdoutBytes).toBeGreaterThan(128)
    expect((error as ControlledProcessError).result?.stderrBytes).toBeGreaterThan(128)
    expect(Buffer.byteLength((error as ControlledProcessError).result?.stdout ?? '')).toBeLessThanOrEqual(128)
    expect(Buffer.byteLength((error as ControlledProcessError).result?.stderr ?? '')).toBeLessThanOrEqual(128)
  })

  it('keeps only the fixed minimal environment allowlist', () => {
    expect(buildMinimalProcessEnv({
      env: { PATH: 'safe-path' },
    }, {
      PATH: 'original-path',
      SECRET_TOKEN: 'must-not-cross-process-boundary',
    })).toEqual({ PATH: 'safe-path' })

    expect(() => buildMinimalProcessEnv({
      env: { SECRET_TOKEN: 'not-approved' },
    }, {
      PATH: 'original-path',
    })).toThrowError(/not approved/)
  })

  it('uses distinct process-tree termination strategies on Windows and POSIX', () => {
    expect(getProcessTerminationStrategy('win32')).toBe('windows-taskkill-tree')
    expect(getProcessTerminationStrategy('linux')).toBe('posix-signals')
    expect(getProcessTerminationStrategy('darwin')).toBe('posix-signals')
  })
})
