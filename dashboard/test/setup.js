import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { TODAY } from './fixtures/calendar.js';

// What jsdom lacks and the page needs:
// - Recharts' ResponsiveContainer watches its size. Charts draw nothing
//   meaningful without a layout anyway: tests read the text around them.
globalThis.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// - the report export downloads a blob URL (see support/downloads.js);
URL.createObjectURL = () => 'blob:stub';
URL.revokeObjectURL = () => {};
// - the PDF export prints the page.
window.print = () => {};

// Recharts warns about every chart, since jsdom gives them no size
const warn = console.warn;
console.warn = (message, ...rest) => {
  if (String(message).startsWith('The width(0) and height(0) of chart')) return;
  warn(message, ...rest);
};

beforeEach(() => {
  // Freeze "today" so that dates and durations read the same on every run.
  // Only Date: React Query and user-event keep their real timers.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(TODAY);
});

afterEach(() => {
  // Without Vitest globals, Testing Library cannot register its own cleanup
  cleanup();
  vi.useRealTimers();
  // The page remembers the chosen language
  localStorage.clear();
});
