// The React Query client of the tests, how to wait for its answers, and the keys it caches
// them under: shared by renderDashboard() (render.jsx) and renderTabHook() (hooks.jsx).

import { vi } from 'vitest';
import { QueryClient, notifyManager } from '@tanstack/react-query';
import { actIn, currentSession } from './session.js';

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
    await actIn(from, 'settle()', () => (timersAreFake()
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
