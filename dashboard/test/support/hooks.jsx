// Renders the hook of a tab as the dashboard shell calls it, with the API answering from a
// dataset: what render.jsx does for the whole page. "Today" is frozen by setup.js here too.

import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { account } from '../fixtures/account.js';
import { serve } from './api.js';

// Calls useTab(props), the API answering from the dataset, and waits until the hook holds
// every answer it asked for. Returns its result, and rerender(props), which calls it again
// with other props, as the shell does when its state changes, and waits the same way.
export async function renderTabHook(useTab, props, data = account) {
  serve(data);
  // A fresh client per test, with the options of render.jsx
  const queryClient = new QueryClient({
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
  const wrapper = ({ children }) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </StrictMode>
  );
  const { result, rerender } = renderHook(useTab, { initialProps: props, wrapper });

  // React Query hands the answers over on a zero-delay timer: settled once such a timer
  // has passed with no request under way, before or after, and the hook did not render.
  const settle = async () => {
    for (;;) {
      const idle = queryClient.isFetching() === 0;
      const rendered = result.current;
      await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
      if (idle && queryClient.isFetching() === 0 && result.current === rendered) return;
    }
  };

  await settle();
  return {
    result,
    async rerender(nextProps) {
      rerender(nextProps);
      await settle();
    },
  };
}
