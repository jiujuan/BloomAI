export type ToolExecutor<Input = any, Output extends object = object> = (
  input: Input,
  context: ToolExecutionContext
) => Promise<Output> | Output

export interface ToolExecutionContext {
  toolId: string
  sessionId?: string
  /** Compatibility fields are optional for direct legacy unit calls; runtime always supplies them. */
  caller?: 'chat' | 'workflow' | 'http' | 'package-runtime'
  allowedRoots?: readonly string[]
  signal?: AbortSignal
  requestId?: string
  toolRunId?: string
}
