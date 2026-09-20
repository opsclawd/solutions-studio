import {
  type ITelemetryRegistry,
  type MetricLabels,
  TelemetryProvider
} from '../../application/ports/observability/ITelemetryRegistry.js';

interface MetricMetadata {
  readonly help: string;
  readonly type: 'counter' | 'gauge' | 'histogram';
}

interface HistogramData {
  count: number;
  sum: number;
  buckets: Map<number, number>;
}

const DEFAULT_HISTOGRAM_BUCKETS = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

const KNOWN_METRIC_METADATA: Record<string, MetricMetadata> = {
  solutions_studio_http_requests_total: {
    help: 'Total incoming API requests by status code',
    type: 'counter'
  },
  solutions_studio_http_request_duration_ms: {
    help: 'Request duration distribution in milliseconds',
    type: 'histogram'
  },
  solutions_studio_auth_failures_total: {
    help: 'Authentication failures by reason',
    type: 'counter'
  },
  solutions_studio_authz_failures_total: {
    help: 'Authorization capability rejections',
    type: 'counter'
  },
  solutions_studio_generation_calls_total: {
    help: 'Generation attempts by provider and outcome',
    type: 'counter'
  },
  solutions_studio_generation_duration_ms: {
    help: 'Time spent in generation engine in milliseconds',
    type: 'histogram'
  },
  solutions_studio_generation_repairs_total: {
    help: 'Count of repair attempts executed',
    type: 'counter'
  },
  solutions_studio_validation_failures_total: {
    help: 'Validation failures across validators',
    type: 'counter'
  },
  solutions_studio_persistence_operations_total: {
    help: 'Database and object store operations',
    type: 'counter'
  },
  solutions_studio_persistence_conflicts_total: {
    help: 'Optimistic concurrency conflicts detected',
    type: 'counter'
  },
  solutions_studio_backlog_exports_total: {
    help: 'Backlog export outcomes by provider and outcome',
    type: 'counter'
  },
  solutions_studio_export_staleness_count: {
    help: 'Active stories count by staleness classification',
    type: 'gauge'
  },
  solutions_studio_governance_approvals_total: {
    help: 'Governance approvals recorded or revoked',
    type: 'counter'
  },
  solutions_studio_governance_failures_total: {
    help: 'Governance rule violations by reason',
    type: 'counter'
  }
};

export class TelemetryRegistry implements ITelemetryRegistry {
  private static defaultInstance = new TelemetryRegistry();

  static get default(): TelemetryRegistry {
    return this.defaultInstance;
  }

  private counters = new Map<string, Map<string, number>>();
  private gauges = new Map<string, Map<string, number>>();
  private histograms = new Map<string, Map<string, HistogramData>>();
  private startTime = Date.now();

  private static readonly MAX_SERIES_PER_METRIC = 500;

  private escapeLabelValue(val: string): string {
    return val.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  }

  private sanitizeLabels(labels?: MetricLabels): Record<string, string> {
    if (!labels) return {};
    const sanitized: Record<string, string> = {};
    for (const [k, v] of Object.entries(labels)) {
      if (v !== undefined && v !== null) {
        sanitized[k] = String(v);
      }
    }
    return sanitized;
  }

  private serializeLabelsKey(labels: Record<string, string>): string {
    const keys = Object.keys(labels).sort();
    return keys.map((k) => `${k}="${this.escapeLabelValue(labels[k])}"`).join(',');
  }

  incrementCounter(name: string, labels?: MetricLabels, value = 1): void {
    if (value < 0) return;
    const cleanLabels = this.sanitizeLabels(labels);
    const key = this.serializeLabelsKey(cleanLabels);

    let metricMap = this.counters.get(name);
    if (!metricMap) {
      metricMap = new Map();
      this.counters.set(name, metricMap);
    }
    let targetKey = key;
    if (!metricMap.has(targetKey) && metricMap.size >= TelemetryRegistry.MAX_SERIES_PER_METRIC) {
      targetKey = 'overflow="true"';
    }
    const current = metricMap.get(targetKey) ?? 0;
    metricMap.set(targetKey, current + value);
  }

  setGauge(name: string, value: number, labels?: MetricLabels): void {
    const cleanLabels = this.sanitizeLabels(labels);
    const key = this.serializeLabelsKey(cleanLabels);

    let metricMap = this.gauges.get(name);
    if (!metricMap) {
      metricMap = new Map();
      this.gauges.set(name, metricMap);
    }
    let targetKey = key;
    if (!metricMap.has(targetKey) && metricMap.size >= TelemetryRegistry.MAX_SERIES_PER_METRIC) {
      targetKey = 'overflow="true"';
    }
    metricMap.set(targetKey, value);
  }

  incrementGauge(name: string, labels?: MetricLabels, value = 1): void {
    const cleanLabels = this.sanitizeLabels(labels);
    const key = this.serializeLabelsKey(cleanLabels);

    let metricMap = this.gauges.get(name);
    if (!metricMap) {
      metricMap = new Map();
      this.gauges.set(name, metricMap);
    }
    let targetKey = key;
    if (!metricMap.has(targetKey) && metricMap.size >= TelemetryRegistry.MAX_SERIES_PER_METRIC) {
      targetKey = 'overflow="true"';
    }
    const current = metricMap.get(targetKey) ?? 0;
    metricMap.set(targetKey, current + value);
  }

  decrementGauge(name: string, labels?: MetricLabels, value = 1): void {
    const cleanLabels = this.sanitizeLabels(labels);
    const key = this.serializeLabelsKey(cleanLabels);

    let metricMap = this.gauges.get(name);
    if (!metricMap) {
      metricMap = new Map();
      this.gauges.set(name, metricMap);
    }
    let targetKey = key;
    if (!metricMap.has(targetKey) && metricMap.size >= TelemetryRegistry.MAX_SERIES_PER_METRIC) {
      targetKey = 'overflow="true"';
    }
    const current = metricMap.get(targetKey) ?? 0;
    metricMap.set(targetKey, current - value);
  }

  observeHistogram(
    name: string,
    value: number,
    labels?: MetricLabels,
    buckets = DEFAULT_HISTOGRAM_BUCKETS
  ): void {
    const cleanLabels = this.sanitizeLabels(labels);
    const key = this.serializeLabelsKey(cleanLabels);

    let metricMap = this.histograms.get(name);
    if (!metricMap) {
      metricMap = new Map();
      this.histograms.set(name, metricMap);
    }

    let targetKey = key;
    if (!metricMap.has(targetKey) && metricMap.size >= TelemetryRegistry.MAX_SERIES_PER_METRIC) {
      targetKey = 'overflow="true"';
    }

    let data = metricMap.get(targetKey);
    if (!data) {
      data = {
        count: 0,
        sum: 0,
        buckets: new Map(buckets.map((b) => [b, 0]))
      };
      metricMap.set(targetKey, data);
    }

    data.count += 1;
    data.sum += value;
    for (const b of buckets) {
      if (value <= b) {
        data.buckets.set(b, (data.buckets.get(b) ?? 0) + 1);
      }
    }
  }

  toPrometheusText(): string {
    const lines: string[] = [];

    // 1. Process Counters
    for (const [name, map] of this.counters.entries()) {
      const meta = KNOWN_METRIC_METADATA[name] ?? {
        help: `${name} metric`,
        type: 'counter'
      };
      lines.push(`# HELP ${name} ${meta.help}`);
      lines.push(`# TYPE ${name} counter`);
      for (const [labelStr, val] of map.entries()) {
        const fullLabelStr = labelStr ? `{${labelStr}}` : '';
        lines.push(`${name}${fullLabelStr} ${val}`);
      }
    }

    // 2. Process Gauges
    for (const [name, map] of this.gauges.entries()) {
      const meta = KNOWN_METRIC_METADATA[name] ?? {
        help: `${name} metric`,
        type: 'gauge'
      };
      lines.push(`# HELP ${name} ${meta.help}`);
      lines.push(`# TYPE ${name} gauge`);
      for (const [labelStr, val] of map.entries()) {
        const fullLabelStr = labelStr ? `{${labelStr}}` : '';
        lines.push(`${name}${fullLabelStr} ${val}`);
      }
    }

    // 3. Process Histograms
    for (const [name, map] of this.histograms.entries()) {
      const meta = KNOWN_METRIC_METADATA[name] ?? {
        help: `${name} metric`,
        type: 'histogram'
      };
      lines.push(`# HELP ${name} ${meta.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const [labelStr, data] of map.entries()) {
        const labelPrefix = labelStr ? `${labelStr},` : '';
        // Buckets
        for (const [b, count] of data.buckets.entries()) {
          lines.push(`${name}_bucket{${labelPrefix}le="${b}"} ${count}`);
        }
        const fullLabelStr = labelStr ? `{${labelStr}}` : '';
        lines.push(`${name}_sum${fullLabelStr} ${data.sum}`);
        lines.push(`${name}_count${fullLabelStr} ${data.count}`);
      }
    }

    return lines.join('\n') + (lines.length > 0 ? '\n' : '');
  }

  toSummaryJson(): Record<string, unknown> {
    const countersJson: Record<string, unknown[]> = {};
    for (const [name, map] of this.counters.entries()) {
      countersJson[name] = Array.from(map.entries()).map(([labels, value]) => ({
        labels,
        value
      }));
    }

    const gaugesJson: Record<string, unknown[]> = {};
    for (const [name, map] of this.gauges.entries()) {
      gaugesJson[name] = Array.from(map.entries()).map(([labels, value]) => ({
        labels,
        value
      }));
    }

    const histogramsJson: Record<string, unknown[]> = {};
    for (const [name, map] of this.histograms.entries()) {
      histogramsJson[name] = Array.from(map.entries()).map(([labels, data]) => ({
        labels,
        count: data.count,
        sum: data.sum,
        avgMs: data.count > 0 ? data.sum / data.count : 0
      }));
    }

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
      timestamp: new Date().toISOString(),
      metrics: {
        counters: countersJson,
        gauges: gaugesJson,
        histograms: histogramsJson
      }
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.startTime = Date.now();
  }
}

TelemetryProvider.setDefault(TelemetryRegistry.default);
