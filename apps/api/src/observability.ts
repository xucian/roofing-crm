import { Logger } from '@aws-lambda-powertools/logger';
import { MetricUnit, Metrics } from '@aws-lambda-powertools/metrics';
import type { MetricUnit as Unit } from '@aws-lambda-powertools/metrics/types';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { METRICS_NAMESPACE, SERVICE_NAME } from './metric-names';

// One of each per execution environment, as Powertools expects. Never logged: lead notes, snapshot
// contents, owner fields (metagross item 15). Logged: request, lead, property and permit ids,
// outcomes, pipeline request ids and durations.
export const logger = new Logger({ serviceName: SERVICE_NAME });
export const tracer = new Tracer({ serviceName: SERVICE_NAME });
export const metrics = new Metrics({
  serviceName: SERVICE_NAME,
  namespace: METRICS_NAMESPACE,
});

export type Dimensions = Readonly<Record<string, string>>;

interface Entry {
  name: string;
  unit: Unit;
  dimensions: Dimensions;
  values: number[];
}

/**
 * The metrics of one request, emitted together when it ends: one EMF record per metric name and
 * dimension set, so a 25-row create writes a few log lines, not one per row and call.
 */
export class RequestMetrics {
  readonly #entries = new Map<string, Entry>();

  count(name: string, dimensions: Dimensions, value = 1): void {
    this.#add(name, MetricUnit.Count, dimensions, value, true);
  }

  milliseconds(name: string, dimensions: Dimensions, value: number): void {
    this.#add(name, MetricUnit.Milliseconds, dimensions, value, false);
  }

  /** What is recorded so far, for tests: `{ "LeadProcessed operation=create": [2] }`. */
  snapshot(): Record<string, number[]> {
    return Object.fromEntries([...this.#entries].map(([key, entry]) => [key, [...entry.values]]));
  }

  flush(target: Metrics): void {
    for (const entry of this.#entries.values()) {
      const single = target.singleMetric();
      for (const [name, value] of Object.entries(entry.dimensions))
        single.addDimension(name, value);
      // A single-metric instance publishes on every addMetric, so each value is added once.
      for (const value of entry.values) single.addMetric(entry.name, entry.unit, value);
    }
    this.#entries.clear();
  }

  #add(name: string, unit: Unit, dimensions: Dimensions, value: number, sum: boolean): void {
    const key = [name, ...Object.entries(dimensions).map(([k, v]) => `${k}=${v}`)].join(' ');
    const entry = this.#entries.get(key);
    if (!entry) {
      this.#entries.set(key, { name, unit, dimensions, values: [value] });
    } else if (sum) {
      entry.values[0] = (entry.values[0] ?? 0) + value;
    } else {
      entry.values.push(value);
    }
  }
}
