// The React Query client of the tests, and how to wait for its answers: shared by
// renderDashboard() (render.jsx) and renderTabHook() (hooks.jsx).

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
  do {
    // Fake timers make a zero-delay timer set while others run due 1 ms later
    await act(() => (timersAreFake()
      ? vi.advanceTimersByTimeAsync(1)
      : new Promise((resolve) => setTimeout(resolve, 0))));
  } while (queryClient.isFetching() + queryClient.isMutating() + pendingNotifications.size > 0);
}
