export type MetricLabelValue = string | number | boolean | undefined;

export interface MetricLabels {
  readonly [key: string]: MetricLabelValue;
}

export interface ITelemetryRegistry {
  incrementCounter(name: string, labels?: MetricLabels, value?: number): void;
  setGauge(name: string, value: number, labels?: MetricLabels): void;
  incrementGauge(name: string, labels?: MetricLabels, value?: number): void;
  decrementGauge(name: string, labels?: MetricLabels, value?: number): void;
  observeHistogram(name: string, value: number, labels?: MetricLabels): void;
  toPrometheusText(): string;
  toSummaryJson(): Record<string, unknown>;
  reset(): void;
}

export class NoopTelemetryRegistry implements ITelemetryRegistry {
  incrementCounter(_name: string, _labels?: MetricLabels, _value?: number): void {}
  setGauge(_name: string, _value: number, _labels?: MetricLabels): void {}
  incrementGauge(_name: string, _labels?: MetricLabels, _value?: number): void {}
  decrementGauge(_name: string, _labels?: MetricLabels, _value?: number): void {}
  observeHistogram(_name: string, _value: number, _labels?: MetricLabels): void {}
  toPrometheusText(): string {
    return '';
  }
  toSummaryJson(): Record<string, unknown> {
    return {};
  }
  reset(): void {}
}

export class TelemetryProvider {
  private static defaultInstance: ITelemetryRegistry = new NoopTelemetryRegistry();

  static setDefault(registry: ITelemetryRegistry): void {
    this.defaultInstance = registry;
  }

  static get default(): ITelemetryRegistry {
    return this.defaultInstance;
  }
}
