import { describe, it, expect, beforeEach } from 'vitest';
import { TelemetryRegistry } from '../../../src/infrastructure/observability/TelemetryRegistry.js';

describe('TelemetryRegistry', () => {
  let registry: TelemetryRegistry;

  beforeEach(() => {
    registry = new TelemetryRegistry();
  });

  it('increments counters accurately with labels', () => {
    registry.incrementCounter('solutions_studio_http_requests_total', {
      method: 'GET',
      route: '/api/health/ready',
      status_code: 200
    });
    registry.incrementCounter('solutions_studio_http_requests_total', {
      method: 'GET',
      route: '/api/health/ready',
      status_code: 200
    });
    registry.incrementCounter('solutions_studio_http_requests_total', {
      method: 'POST',
      route: '/api/baselines',
      status_code: 201
    });

    const summary = registry.toSummaryJson() as any;
    expect(summary.metrics.counters.solutions_studio_http_requests_total).toHaveLength(2);

    const getMetric = summary.metrics.counters.solutions_studio_http_requests_total.find((m: any) =>
      m.labels.includes('method="GET"')
    );
    expect(getMetric.value).toBe(2);

    const postMetric = summary.metrics.counters.solutions_studio_http_requests_total.find(
      (m: any) => m.labels.includes('method="POST"')
    );
    expect(postMetric.value).toBe(1);
  });

  it('sets, increments, and decrements gauges', () => {
    registry.setGauge('solutions_studio_export_staleness_count', 5, { classification: 'CURRENT' });
    registry.incrementGauge(
      'solutions_studio_export_staleness_count',
      { classification: 'CURRENT' },
      2
    );
    registry.decrementGauge(
      'solutions_studio_export_staleness_count',
      { classification: 'CURRENT' },
      1
    );

    const summary = registry.toSummaryJson() as any;
    const gauge = summary.metrics.gauges.solutions_studio_export_staleness_count[0];
    expect(gauge.value).toBe(6);
  });

  it('records histogram observations and calculates count, sum, and avg', () => {
    registry.observeHistogram('solutions_studio_http_request_duration_ms', 50, { method: 'GET' });
    registry.observeHistogram('solutions_studio_http_request_duration_ms', 150, { method: 'GET' });

    const summary = registry.toSummaryJson() as any;
    const hist = summary.metrics.histograms.solutions_studio_http_request_duration_ms[0];
    expect(hist.count).toBe(2);
    expect(hist.sum).toBe(200);
    expect(hist.avgMs).toBe(100);
  });

  it('formats Prometheus text exposition conforming to standard', () => {
    registry.incrementCounter(
      'solutions_studio_auth_failures_total',
      { reason: 'TOKEN_EXPIRED' },
      3
    );
    registry.observeHistogram('solutions_studio_http_request_duration_ms', 45, { method: 'GET' });

    const prometheusText = registry.toPrometheusText();

    expect(prometheusText).toContain('# HELP solutions_studio_auth_failures_total');
    expect(prometheusText).toContain('# TYPE solutions_studio_auth_failures_total counter');
    expect(prometheusText).toContain(
      'solutions_studio_auth_failures_total{reason="TOKEN_EXPIRED"} 3'
    );

    expect(prometheusText).toContain('# HELP solutions_studio_http_request_duration_ms');
    expect(prometheusText).toContain('# TYPE solutions_studio_http_request_duration_ms histogram');
    expect(prometheusText).toContain(
      'solutions_studio_http_request_duration_ms_bucket{method="GET",le="50"} 1'
    );
    expect(prometheusText).toContain(
      'solutions_studio_http_request_duration_ms_count{method="GET"} 1'
    );
    expect(prometheusText).toContain(
      'solutions_studio_http_request_duration_ms_sum{method="GET"} 45'
    );
  });

  it('resets all metrics on reset()', () => {
    registry.incrementCounter('solutions_studio_auth_failures_total', { reason: 'MISSING_TOKEN' });
    registry.reset();

    const summary = registry.toSummaryJson() as any;
    expect(Object.keys(summary.metrics.counters)).toHaveLength(0);
  });

  it('escapes quotes, backslashes, and newlines in Prometheus label values', () => {
    registry.incrementCounter('solutions_studio_auth_failures_total', {
      reason: 'line1\nline2 with "quotes" and \\backslashes\\'
    });

    const prometheusText = registry.toPrometheusText();
    expect(prometheusText).toContain(
      'reason="line1\\nline2 with \\"quotes\\" and \\\\backslashes\\\\"'
    );
  });

  it('caps series cardinality to prevent unbounded memory growth', () => {
    for (let i = 0; i < 550; i++) {
      registry.incrementCounter('solutions_studio_http_requests_total', {
        method: 'GET',
        route: `/unique/path/${i}`,
        status_code: 404
      });
    }

    const summary = registry.toSummaryJson() as any;
    const series = summary.metrics.counters.solutions_studio_http_requests_total;
    // Series count should not exceed 501 (500 max + 1 overflow series)
    expect(series.length).toBeLessThanOrEqual(501);
    const overflowSeries = series.find((s: any) => s.labels.includes('overflow="true"'));
    expect(overflowSeries).toBeDefined();
    expect(overflowSeries.value).toBeGreaterThanOrEqual(50);
  });
});
