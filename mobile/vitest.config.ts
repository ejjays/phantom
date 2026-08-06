import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // termux phantom-killer: one worker, sequential
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
    maxConcurrency: 1,
    reporters: ['default', 'junit'],
    outputFile: './test-results.xml',
  },
});
