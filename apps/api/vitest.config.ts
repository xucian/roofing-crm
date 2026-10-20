import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Powertools would print every log line and EMF record of the handler tests.
    env: {
      POWERTOOLS_LOG_LEVEL: 'SILENT',
      POWERTOOLS_METRICS_DISABLED: 'true',
      POWERTOOLS_TRACE_ENABLED: 'false',
    },
  },
});
