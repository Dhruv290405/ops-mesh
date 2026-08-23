import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000
  },
  resolve: {
    alias: {
      '@opsmesh/shared': path.resolve(process.cwd(), '../../packages/shared/src/index.ts'),
      '@opsmesh/config': path.resolve(process.cwd(), '../../packages/config/src/index.ts'),
      '@opsmesh/infra': path.resolve(process.cwd(), '../../packages/infra/src/index.ts')
    }
  }
});