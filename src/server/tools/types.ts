export type ToolExecutor<Input = any, Output extends object = object> = (
  input: Input,
  context: ToolExecutionContext
) => Promise<Output> | Output

export interface ToolExecutionContext {
  toolId: string
  sessionId?: string
}
