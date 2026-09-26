// The React Query client of the tests, how to wait for its answers, and the keys it caches
// them under: shared by renderDashboard() (render.jsx) and renderTabHook() (hooks.jsx). And
// the session of each test, which stops what a test left running once it is over.

import { vi } from 'vitest';
import { act } from '@testing-library/react';
import { QueryClient, notifyManager } from '@tanstack/react-query';

// React Query hands answers over to the page on a zero-delay timer. Same
// timer here, tracked, so that settle() knows when none is on its way. Each
// client tracks its own: a timer left over by another test does not count.
let pendingNotifications = new Set();
notifyManager.setScheduler((callback) => {
  const pending = pendingNotifications;
  const notify = () => {
    pending.delete(notify);
    callback();
  };
  pending.add(notify);
  setTimeout(notify, 0);
});

// Whether setTimeout is faked, and not only Date: Vitest's fake timers carry
// their clock, which is what Testing Library looks for too.
export const timersAreFake = () => Object.hasOwn(globalThis.setTimeout, 'clock');

// A test that fails or times out while a helper waits, such as a renderDashboard() it has
// not awaited yet, leaves the helper running into the next test. Its act() then overlaps
// those of the next test, which React does not support: from then on, React no longer
// renders what the page loads, and every following test of the file fails. And its next
// steps would act on the page of the next test. So each test runs in a session, which
// endTest() closes after it (see setup.js): what the test left running stops at its next
// step, for good.
const openSession = () => ({ over: false, acting: Promise.resolve() });
let session = openSession();
const never = new Promise(() => {});

// The session of the test that runs
export const currentSession = () => session;

// Nothing while the test of the session runs; once it is over, a wait that never ends
export const stopIfOver = (from) => (from.over ? never : undefined);

// Runs callback in act() for the test of the session, unless it is over
export async function actIn(from, callback) {
  await stopIfOver(from);
  // Awaited once only: each then() on what act() returns closes its scope again
  from.acting = (async () => {
    await act(callback);
  })();
  await from.acting;
  await stopIfOver(from);
}

// Closes the session of the test that ran: its act() in progress, if any, ends before the
// next test opens its own, and what the test left running stops
export async function endTest() {
  const ended = session;
  ended.over = true;
  session = openSession();
  await ended.acting.catch(() => {});
}

// A fresh client per test, with the options of src/main.jsx; no retry, and
// no garbage collection timer left behind. From now on, settle() waits for
// the answers it hands over.
export function createQueryClient() {
  pendingNotifications = new Set();
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: false,
        gcTime: Infinity,
      },
      mutations: { retry: false },
    },
  });
}

// Waits until the client has received every answer it was asked for,
// including the requests those answers lead to, and handed them over.
export async function settle(queryClient) {
  const from = currentSession();
  do {
    // Fake timers make a zero-delay timer set while others run due 1 ms later
    await actIn(from, () => (timersAreFake()
      ? vi.advanceTimersByTimeAsync(1)
      : new Promise((resolve) => setTimeout(resolve, 0))));
  } while (queryClient.isFetching() + queryClient.isMutating() + pendingNotifications.size > 0);
}

// The keys the client caches the answers of its queries under, in the order it first built
// them: of every query it holds, whether it ran or waits for what it needs, or of those that
// match the filters, such as { queryKey: [name] } for the queries of one name
export function keysIn(queryClient, filters = {}) {
  return queryClient.getQueriesData(filters).map(([queryKey]) => queryKey);
}
