export {}

declare global {
  interface Window {
    bloomai?: {
      readClipboard(): Promise<string>
      writeClipboard(text: string): Promise<boolean>
      getActiveWindow(): Promise<string>
      closeOverlay(): Promise<void>
      openMain(): Promise<void>
      getVersion(): Promise<string>
      openExternal(url: string): Promise<void>
      saveImage(srcUrl: string, defaultName: string): Promise<boolean>
      selectDirectory(): Promise<{ canceled: boolean; path?: string }>
      requestToolApproval(intent: {
        toolId: string
        sessionId: string
        input: Record<string, unknown>
      }): Promise<{ approved: boolean; approvalToken?: string }>
    }
  }
}
