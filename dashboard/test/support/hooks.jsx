// Renders the hook of a tab as the dashboard shell calls it, with the API answering from a
// dataset: what render.jsx does for the whole page. "Today" is frozen by setup.js here too.

import { StrictMode } from 'react';
import { renderHook } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { account } from '../fixtures/account.js';
import { serve } from './api.js';
import { createQueryClient, settle } from './query-client.js';

// The ids of the dashboard's tabs, in the order of the tab bar, as the shell's activeTab
// holds them: 'inventory' is the Public Cloud tab.
export const TAB_IDS = [
  'overview', 'compare', 'trends', 'inventory', 'webcloud', 'infrastructure', 'backup',
];

// The state, in the query cache, of a query that waits for what it needs, a month or a
// project, rather than failing for the lack of it: pending, not fetching, and without
// error. A query that fails before its request sends nothing either: only this state tells
// them apart.
export const WAITING = { status: 'pending', fetchStatus: 'idle', error: null };

// Calls useTab(props), the API answering from the dataset, and waits until the hook holds
// every answer it asked for. Returns its result, the query client that holds the answers,
// keysOf(name), the keys that client caches the answers of a query under, and
// rerender(props), which calls it again with other props, as the shell does when its state
// changes, and waits the same way.
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
    // The cache is the page's: each period keeps its own answers there, and the end of an
    // import invalidates them by the name of their query
    keysOf: (name) => queryClient.getQueriesData({ queryKey: [name] })
      .map(([queryKey]) => queryKey),
    async rerender(nextProps) {
      rerender(nextProps);
      await settle(queryClient);
    },
  };
}
