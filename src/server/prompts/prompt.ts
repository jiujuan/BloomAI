import type { ChatPromptContext, OrganizedChatPrompt, OrganizeChatPromptOptions } from './types'

const DEFAULT_MAX_TOKENS = 4096
const CLIPBOARD_CONTEXT_LIMIT = 800

export function organizeChatPrompt(
  context: ChatPromptContext,
  options: OrganizeChatPromptOptions = {}
): OrganizedChatPrompt {
  const contextParts: string[] = []
  if (context.contextOverride?.activeApp) {
    contextParts.push(`Active app: ${context.contextOverride.activeApp}`)
  }
  if (context.contextOverride?.clipboardContent) {
    contextParts.push(`Clipboard:\n${String(context.contextOverride.clipboardContent).slice(0, CLIPBOARD_CONTEXT_LIMIT)}`)
  }

  return {
    system: contextParts.length
      ? `${context.baseSystemPrompt}\n\n---\n${contextParts.join('\n')}`
      : context.baseSystemPrompt,
    messages: [
      ...context.history,
      {
        role: 'user',
        content: context.userContent,
      },
    ],
    maxTokens: options.maxTokens || DEFAULT_MAX_TOKENS,
  }
}
