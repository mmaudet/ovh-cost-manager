import { StrictMode } from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { LanguageProvider } from '../../src/hooks/useLanguage.jsx';
import App from '../../src/App.jsx';
import { account } from '../fixtures/account.js';
import { serve } from './api.js';

// React Query hands answers over to the page on a zero-delay timer. Same
// timer here, counted, so that settle() knows when none is on its way.
let pendingNotifications = 0;
notifyManager.setScheduler((callback) => {
  pendingNotifications += 1;
  setTimeout(() => {
    pendingNotifications -= 1;
    callback();
  }, 0);
});

let queryClient;

// Renders the whole dashboard as src/main.jsx does, with the API answering
// from the dataset, and waits until the page shows every answer.
export async function renderDashboard(data = account) {
  serve(data);
  // A fresh client per test, with the options of src/main.jsx; no retry, and
  // no garbage collection timer left behind.
  queryClient = new QueryClient({
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
  const user = userEvent.setup();
  render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <LanguageProvider defaultLanguage="fr">
          <App />
        </LanguageProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  await settle();
  return { user };
}

// Waits until the page has received every answer it asked for, including the
// requests those answers lead to, and shows them.
export async function settle() {
  do {
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  } while (queryClient.isFetching() + queryClient.isMutating() + pendingNotifications > 0);
}

export async function openTab(user, name) {
  // The tab bar is the group of buttons that holds the Overview tab
  const overview = screen.getByRole('button', { name: /^(Vue d'ensemble|Overview)$/ });
  await user.click(within(overview.parentElement).getByRole('button', { name }));
  await settle();
}

// The month selector of the header: its options are months ('2026-09')
export function monthSelector() {
  return screen.getAllByRole('combobox').find((select) =>
    [...select.options].some((option) => /^\d{4}-\d{2}$/.test(option.value)));
}

export async function selectMonth(user, label) {
  await user.selectOptions(monthSelector(), label);
  await settle();
}

export async function selectLanguage(user, code) {
  const selector = screen.getAllByRole('combobox').find((select) =>
    [...select.options].some((option) => option.value === 'en'));
  await user.selectOptions(selector, code);
  await settle();
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

// The texts of an element as a user reads them: the text of each element in
// it, in order. Whitespace is normalized, so the narrow no-break space that
// separates thousands in French amounts reads as a plain space.
export function texts(element) {
  const pieces = [];
  let parent = null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement === parent) {
      pieces[pieces.length - 1] += node.textContent;
    } else {
      pieces.push(node.textContent);
      parent = node.parentElement;
    }
  }
  return pieces.map(normalize).filter(Boolean);
}

// The card or panel that shows a label, or holds an element: the page draws
// them as white blocks with rounded corners.
export function cardOf(labelOrElement) {
  const element = typeof labelOrElement === 'string'
    ? screen.getByText(labelOrElement)
    : labelOrElement;
  return element.closest('.rounded-xl');
}

// The rows of a table, header and footer included, as lists of cell texts
export function rowsOf(table) {
  return [...table.querySelectorAll('tr')].map((row) =>
    [...row.cells].map((cell) => normalize(cell.textContent)));
}
