import type {
  McpBrokerExecuteInput,
  McpBrokerSuccess,
  McpCapabilityBroker,
} from './capability-broker'

export type McpToolAdapterOptions = {
  broker: Pick<McpCapabilityBroker, 'execute'>
}

/**
 * Shared application-facing Tool surface. Agent execution and manual Test
 * deliberately use the same injected Capability Broker and therefore cannot
 * bypass approval, policy, timeout, cancellation, or audit behavior.
 */
export class McpToolAdapter {
  private readonly broker: Pick<McpCapabilityBroker, 'execute'>

  constructor(options: McpToolAdapterOptions) {
    this.broker = options.broker
  }

  execute(input: McpBrokerExecuteInput): Promise<McpBrokerSuccess> {
    return this.broker.execute({ ...input, caller: 'agent' })
  }

  test(input: McpBrokerExecuteInput): Promise<McpBrokerSuccess> {
    return this.broker.execute({ ...input, caller: 'manual_test' })
  }
}
