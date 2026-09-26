// Renders the hook of a tab as the dashboard shell calls it, with the API answering from a
// dataset: what render.jsx does for the whole page. "Today" is frozen by setup.js here too.

import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { account } from '../fixtures/account.js';
import { serve } from './api.js';
import { createQueryClient, settle } from './query-client.js';

// Calls useTab(props), the API answering from the dataset, and waits until the hook holds
// every answer it asked for. Returns its result, the query client that holds the answers,
// and rerender(props), which calls it again with other props, as the shell does when its
// state changes, and waits the same way.
export async function renderTabHook(useTab, props, data = account) {
  serve(data);
  const queryClient = createQueryClient();
  const wrapper = ({ children }) => (
    <StrictMode>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </StrictMode>
  );
  const { result, rerender } = renderHook(useTab, { initialProps: props, wrapper });
  await settle(queryClient);
  return {
    result,
    queryClient,
    async rerender(nextProps) {
      rerender(nextProps);
      await settle(queryClient);
    },
  };
}
