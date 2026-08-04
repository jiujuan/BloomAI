import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getDataDir } from '../db/paths'
import { getWebBrowserConfig } from './web/config'

export type ToolAvailability =
  | { status: 'available' }
  | { status: 'disabled'; reason: string }
  | { status: 'dependency_missing'; dependency: string; reason: string }
  | { status: 'configuration_missing'; setting: string; reason: string }
  | { status: 'unsupported_platform'; platform: NodeJS.Platform; reason: string }

const PLACEHOLDER_AVAILABILITY: Record<string, Extract<ToolAvailability, { status: 'dependency_missing' }>> = {
  web_screenshot: {
    status: 'dependency_missing',
    dependency: 'playwright',
    reason: 'Screenshot provider is not implemented or installed.',
  },
  ocr: {
    status: 'dependency_missing',
    dependency: 'ocr-backend',
    reason: 'OCR backend is not configured.',
  },
  image_edit: {
    status: 'dependency_missing',
    dependency: 'image-processing-backend',
    reason: 'Image editing backend is not configured.',
  },
}

const EXECUTION_AVAILABILITY: Record<string, Extract<ToolAvailability, { status: 'disabled' }>> = {
  node_runner: {
    status: 'disabled',
    reason: 'Node execution is disabled until the C2 OS isolation threat model and acceptance are complete. node:vm is only a restricted execution environment, not an OS sandbox.',
  },
  python_runner: {
    status: 'disabled',
    reason: 'Python execution is disabled until a cross-platform OS isolation boundary and acceptance are complete.',
  },
  shell: {
    status: 'disabled',
    reason: 'Shell execution is disabled until a cross-platform OS isolation boundary and acceptance are complete.',
  },
}

export function getToolAvailability(toolId: string): ToolAvailability {
  if (toolId === 'web_screenshot') return getWebScreenshotAvailability()
  if (EXECUTION_AVAILABILITY[toolId]) return EXECUTION_AVAILABILITY[toolId]
  return PLACEHOLDER_AVAILABILITY[toolId] ?? { status: 'available' }
}

export function isToolAvailable(toolId: string): boolean {
  return getToolAvailability(toolId).status === 'available'
}

export class ToolUnavailableError extends Error {
  constructor(readonly toolId: string, readonly availability: ToolAvailability) {
    super(formatAvailabilityError(toolId, availability))
    this.name = 'ToolUnavailableError'
  }
}

export function requireToolAvailability(toolId: string): void {
  const availability = getToolAvailability(toolId)
  if (availability.status !== 'available') throw new ToolUnavailableError(toolId, availability)
}

function formatAvailabilityError(toolId: string, availability: ToolAvailability): string {
  if (availability.status === 'dependency_missing') {
    return `Tool ${toolId} is unavailable: missing ${availability.dependency}. ${availability.reason}`
  }
  if (availability.status === 'configuration_missing') {
    return `Tool ${toolId} is unavailable: missing setting ${availability.setting}. ${availability.reason}`
  }
  if (availability.status === 'unsupported_platform') {
    return `Tool ${toolId} is unavailable on ${availability.platform}. ${availability.reason}`
  }
  return `Tool ${toolId} is unavailable: ${availability.status === 'available' ? 'unknown reason' : availability.reason}`
}

function getWebScreenshotAvailability(): ToolAvailability {
  const config = getWebBrowserConfig()
  if (!config.enabled) {
    return {
      status: 'disabled',
      reason: 'Browser provider is disabled. Set WEB_BROWSER_ENABLED=true only after browser policy and artifact checks are configured.',
    }
  }
  const artifactAvailability = checkScreenshotArtifactDirectory()
  if (artifactAvailability) return artifactAvailability
  if (!hasKnownSystemBrowser(config.channels)) {
    return {
      status: 'dependency_missing',
      dependency: 'system-browser',
      reason: `No configured browser channel is installed (${config.channels.join(', ')}).`,
    }
  }
  return { status: 'available' }
}

function checkScreenshotArtifactDirectory(): Extract<ToolAvailability, { status: 'configuration_missing' }> | undefined {
  const artifactDir = path.join(getDataDir(), 'tool-artifacts', 'web-screenshot')
  try {
    const stats = fs.lstatSync(artifactDir)
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      return {
        status: 'configuration_missing',
        setting: 'artifact_dir',
        reason: 'Screenshot artifact directory must be a regular writable directory.',
      }
    }
    fs.accessSync(artifactDir, fs.constants.W_OK)
    return undefined
  } catch {
    return {
      status: 'configuration_missing',
      setting: 'artifact_dir',
      reason: 'Screenshot artifact directory is missing or not writable.',
    }
  }
}

function hasKnownSystemBrowser(channels: readonly string[]): boolean {
  const candidates: Record<string, string[]> = {
    msedge: [
      path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(process.env.LOCALAPPDATA || os.homedir(), 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    chrome: [
      path.join(process.env.ProgramFiles || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(process.env.LOCALAPPDATA || os.homedir(), 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
  }
  return channels.some((channel) => (candidates[channel] || []).some((candidate) => candidate && fs.existsSync(candidate)))
}
