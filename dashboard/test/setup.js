import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { TODAY } from './fixtures/calendar.js';
import { endTest } from './support/query-client.js';

// Every test file gets the stand-in of the API service module (support/api.js)
vi.mock('../src/services/api.js', async () => (await import('./support/api.js')).api);

// What jsdom lacks and the page needs:
// - Recharts' ResponsiveContainer watches its size. Charts draw nothing
//   meaningful without a layout anyway: tests read the text around them.
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// - downloads, CSV exports and report, go through a blob URL (see
//   support/downloads.js);
URL.createObjectURL = () => 'blob:stub';
URL.revokeObjectURL = () => {};
// - the PDF export prints the page.
window.print = () => {};

// Testing Library ends each user action by waiting on a zero-delay timer.
// When the timers are fake (see fakeTimers() in support/render.jsx), it only
// moves them on through Jest's API: lend it Vitest's. Inert otherwise.
globalThis.jest = { advanceTimersByTime: (ms) => vi.advanceTimersByTime(ms) };

// Recharts warns about every chart, since jsdom gives them no size
const warn = console.warn;
console.warn = (message, ...rest) => {
  if (String(message).startsWith('The width(0) and height(0) of chart')) return;
  warn(message, ...rest);
};

beforeEach(() => {
  // Freeze "today" so that dates and durations read the same on every run.
  // Only Date: React Query and user-event keep their real timers, except in
  // the tests that fake them too (fakeTimers() in support/render.jsx).
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(async () => {
  // First stop what the test left running, if it failed or timed out while a helper of
  // support/ waited, so that the next test starts clean (see endTest())
  await endTest();
  // Without Vitest globals, Testing Library cannot register its own cleanup
  cleanup();
  vi.useRealTimers();
  // The page remembers the chosen language
  localStorage.clear();
});
