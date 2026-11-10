import { defineConfig } from 'vitest/config';
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['libs/common/src/rabbitmq/test/rabbitmq.integration.ts'],
    testTimeout: 60000,
    hookTimeout: 20000,
    fileParallelism: false,
  },
});
