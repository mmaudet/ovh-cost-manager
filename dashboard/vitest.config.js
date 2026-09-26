import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.js';

// Same plugins as the build (JSX), plus the test environment.
export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.{js,jsx}'],
    setupFiles: ['./test/setup.js'],
    // Dates and times display in local time: pin the zone so that the tests
    // read the same on every machine, CI included.
    env: { TZ: 'Europe/Paris' },
    // Every test starts with fresh mocks: no call, answer or spy left over
    mockReset: true,
    restoreMocks: true,
  },
}));
