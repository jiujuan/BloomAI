import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import { BatchSpanProcessor, ConsoleSpanExporter } from '@opentelemetry/sdk-trace-base'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { trace, context, SpanStatusCode } from '@opentelemetry/api'
import { readConfigValue } from '../config/config'

let _provider: NodeTracerProvider | null = null

/**
 * Initialize the global OTel TracerProvider. Must be called after loadDotEnv()
 * and before the first request is processed.
 *
 * - OTEL_ENABLED=false  → no-op, provider stays null
 * - OTEL_EXPORTER_OTLP_ENDPOINT set → OTLP/HTTP exporter (Jaeger, Grafana Tempo, …)
 * - Otherwise           → ConsoleSpanExporter (stdout, for local dev without Jaeger)
 */
export function initTracing(): void {
  if (readConfigValue('OTEL_ENABLED', 'true').value === 'false') return

  const endpoint = readConfigValue('OTEL_EXPORTER_OTLP_ENDPOINT', '').value
  const exporter = endpoint
    ? new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
    : new ConsoleSpanExporter()

  _provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'bloomai',
      [ATTR_SERVICE_VERSION]: '0.3.0',
    }),
    spanProcessors: [new BatchSpanProcessor(exporter)],
  })
  _provider.register() // registers as the global TracerProvider
}

/** Flush pending spans and shut down the provider. Call on SIGTERM/SIGINT. */
export async function shutdownTracing(): Promise<void> {
  if (_provider) await _provider.shutdown()
}

/** Get a named tracer. Returns a no-op tracer when tracing is disabled. */
export function getTracer(name: string) {
  return trace.getTracer(name)
}

export { SpanStatusCode, context, trace }
