type ToolLike = {
  is_enabled: number
  availability?: { status?: string; reason?: string }
}

export function canRunTool(tool: ToolLike): { allowed: true } | { allowed: false; reason: string } {
  if (tool.availability && tool.availability.status !== 'available') {
    return { allowed: false, reason: tool.availability.reason || `Tool is ${tool.availability.status}` }
  }
  if (tool.is_enabled !== 1) return { allowed: false, reason: 'Tool is disabled' }
  return { allowed: true }
}
