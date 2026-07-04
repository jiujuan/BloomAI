import { MeterProvider, PeriodicExportingMetricReader, ConsoleMetricExporter } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions'
import { metrics } from '@opentelemetry/api'
import { readConfigValue } from '../config/config'

let _meterProvider: MeterProvider | null = null

/**
 * Initialize the global OTel MeterProvider. Must be called after loadDotEnv()
 * and before the first request is processed.
 *
 * - OTEL_ENABLED=false               → no-op
 * - OTEL_EXPORTER_OTLP_ENDPOINT set  → OTLP/HTTP to Prometheus / Grafana Tempo / …
 * - Otherwise                        → ConsoleMetricExporter (stdout, dev fallback)
 *
 * Metrics are exported every 30 s. Call shutdownMetrics() on process exit to flush.
 */
export function initMetrics(): void {
  if (readConfigValue('OTEL_ENABLED', 'true').value === 'false') return

  const endpoint = readConfigValue('OTEL_EXPORTER_OTLP_ENDPOINT', '').value
  const exporter = endpoint
    ? new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` })
    : new ConsoleMetricExporter()

  _meterProvider = new MeterProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'bloomai',
      [ATTR_SERVICE_VERSION]: '0.3.0',
    }),
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 30_000 })],
  })

  metrics.setGlobalMeterProvider(_meterProvider)
}

/** Flush pending metric batches and shut down. Call on SIGTERM/SIGINT. */
export async function shutdownMetrics(): Promise<void> {
  if (_meterProvider) await _meterProvider.shutdown()
}

/**
 * Get a named Meter from the global MeterProvider. Returns a no-op Meter when
 * metrics are disabled. Always call this inside a function body (not at module
 * top level) so it runs after initMetrics() has registered the global provider.
 */
export function getMeter(name: string) {
  return metrics.getMeter(name, '0.3.0')
}
