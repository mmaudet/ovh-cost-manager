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
    // A page test renders the whole dashboard, and walks through its tabs: the slowest
    // take over 1.5 s on an idle machine, and more than Vitest's default of 5 s on a
    // loaded one, as navigation.test.jsx did. 20 s absorbs the load, and still stops a
    // test that hangs.
    testTimeout: 20000,
  },
}));
