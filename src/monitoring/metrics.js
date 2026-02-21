function sanitizeLabelValue(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n');
}

function labelsKey(labels = {}) {
  const entries = Object.entries(labels).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(entries);
}

function formatLabels(labels = {}) {
  const entries = Object.entries(labels);
  if (!entries.length) return '';
  return `{${entries.map(([k, v]) => `${k}="${sanitizeLabelValue(v)}"`).join(',')}}`;
}

class CounterMetric {
  constructor(name, help) {
    this.name = name;
    this.help = help;
    this.type = 'counter';
    this.samples = new Map();
  }

  inc(value = 1, labels = {}) {
    const key = labelsKey(labels);
    const prev = this.samples.get(key) ?? { labels, value: 0 };
    prev.value += value;
    this.samples.set(key, prev);
  }
}

class GaugeMetric {
  constructor(name, help) {
    this.name = name;
    this.help = help;
    this.type = 'gauge';
    this.samples = new Map();
  }

  set(value, labels = {}) {
    const key = labelsKey(labels);
    this.samples.set(key, { labels, value });
  }

  inc(value = 1, labels = {}) {
    const key = labelsKey(labels);
    const prev = this.samples.get(key) ?? { labels, value: 0 };
    prev.value += value;
    this.samples.set(key, prev);
  }

  dec(value = 1, labels = {}) {
    this.inc(-value, labels);
  }
}

export class MetricsRegistry {
  constructor(options = {}) {
    this.prefix = options.prefix ?? 'fluxer_bot_';
    this.metrics = new Map();
  }

  counter(name, help) {
    const full = `${this.prefix}${name}`;
    const existing = this.metrics.get(full);
    if (existing) return existing;
    const metric = new CounterMetric(full, help);
    this.metrics.set(full, metric);
    return metric;
  }

  gauge(name, help) {
    const full = `${this.prefix}${name}`;
    const existing = this.metrics.get(full);
    if (existing) return existing;
    const metric = new GaugeMetric(full, help);
    this.metrics.set(full, metric);
    return metric;
  }

  renderPrometheus() {
    const lines = [];
    for (const metric of this.metrics.values()) {
      lines.push(`# HELP ${metric.name} ${metric.help}`);
      lines.push(`# TYPE ${metric.name} ${metric.type}`);

      if (metric.samples.size === 0) {
        lines.push(`${metric.name} 0`);
        continue;
      }

      for (const sample of metric.samples.values()) {
        lines.push(`${metric.name}${formatLabels(sample.labels)} ${sample.value}`);
      }
    }
    return `${lines.join('\n')}\n`;
  }
}
