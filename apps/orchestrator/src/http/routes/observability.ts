import type { FastifyPluginAsync } from 'fastify';
import type { ITelemetryRegistry } from '../../application/ports/observability/ITelemetryRegistry.js';

export interface ObservabilityRoutesOptions {
  readonly telemetryRegistry: ITelemetryRegistry;
}

export const observabilityRoutes: FastifyPluginAsync<ObservabilityRoutesOptions> = async (
  fastify,
  opts
) => {
  fastify.get('/api/metrics', async (_request, reply) => {
    const text = opts.telemetryRegistry.toPrometheusText();
    return reply.type('text/plain; version=0.0.4; charset=utf-8').send(text);
  });

  fastify.get('/api/telemetry/summary', async (_request, reply) => {
    const summary = opts.telemetryRegistry.toSummaryJson();
    return reply.status(200).send(summary);
  });
};
