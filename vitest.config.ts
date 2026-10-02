import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // `server-only` throws unless resolved under React's server condition, as Next.js resolves it for server
      // code; the tests run that code in plain Node, so they get the package's empty module.
      'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js'),
    },
  },
});
