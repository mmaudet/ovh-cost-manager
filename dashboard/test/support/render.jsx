// Renders the dashboard page, and finds what the user sees on it.
//
// The lookups of this file (cards, dropdowns, badges, backdrops...) are the
// tests' only coupling to the markup: the page may not change for its tests,
// so it has no test ids. When the markup changes, as it will with the common
// panel planned after the split, the tests are fixed here, in one place.

import { StrictMode } from 'react';
import { vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, notifyManager } from '@tanstack/react-query';
import { LanguageProvider } from '../../src/hooks/useLanguage.jsx';
import App from '../../src/App.jsx';
import { account } from '../fixtures/account.js';
import { TODAY } from '../fixtures/calendar.js';
import { serve } from './api.js';

// React Query hands answers over to the page on a zero-delay timer. Same
// timer here, tracked, so that settle() knows when none is on its way. Each
// render tracks its own: a timer left over by another test does not count.
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
const timersAreFake = () => Object.hasOwn(globalThis.setTimeout, 'clock');

let queryClient;

// Renders the whole dashboard as src/main.jsx does, with the API answering
// from the dataset, and waits until the page shows every answer.
export async function renderDashboard(data = account) {
  serve(data);
  pendingNotifications = new Set();
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
  // Under fake timers, user-event moves the clock on for its own delays
  const user = userEvent.setup(timersAreFake()
    ? { advanceTimers: (ms) => vi.advanceTimersByTime(ms) }
    : {});
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
    // Fake timers make a zero-delay timer set while others run due 1 ms later
    await act(() => (timersAreFake()
      ? vi.advanceTimersByTimeAsync(1)
      : new Promise((resolve) => setTimeout(resolve, 0))));
  } while (queryClient.isFetching() + queryClient.isMutating() + pendingNotifications.size > 0);
}

// Fakes the timers as well as Date, for the tests that wait for the page's
// own timers: the import status refreshed 8 s after a resync, and polled
// every 30 s while an import runs. To call before renderDashboard().
export function fakeTimers() {
  vi.useFakeTimers({
    now: TODAY,
    toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
  });
}

// Under fake timers, lets time pass, then waits until the page shows what
// that time brought
export async function passTime(ms) {
  await act(() => vi.advanceTimersByTimeAsync(ms));
  await settle();
}

export async function openTab(user, name) {
  // The tab bar is the group of buttons that holds the Overview tab
  const overview = screen.getByRole('button', { name: /^(Vue d'ensemble|Overview)$/ });
  await user.click(within(overview.parentElement).getByRole('button', { name }));
  await settle();
}

// The labels of the options of a dropdown
export function optionsOf(select) {
  return within(select).getAllByRole('option').map((option) => option.textContent);
}

// The dropdown that offers an option: dropdown('Juillet 2026') is the month
// selector, dropdown('EN') the language one. When several offer it, like the
// months A and B of the Compare tab, the option it shows tells them apart.
export function dropdown(offering, showing) {
  const found = screen.getAllByRole('combobox').filter((select) =>
    optionsOf(select).includes(offering)
    && (showing === undefined || select.selectedOptions[0]?.textContent === showing));
  if (found.length !== 1) {
    const shown = showing === undefined ? '' : ` and show "${showing}"`;
    throw new Error(`${found.length} dropdowns offer "${offering}"${shown}`);
  }
  return found[0];
}

export async function selectMonth(user, label) {
  // The month selector offers every month
  await user.selectOptions(dropdown(label), label);
  await settle();
}

export async function selectLanguage(user, code) {
  await user.selectOptions(dropdown('EN'), code);
  await settle();
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();

// A closed dropdown shows the option it holds, not the others
const shownByDropdowns = (node) => (node.parentElement.closest('option')?.selected === false
  ? NodeFilter.FILTER_REJECT
  : NodeFilter.FILTER_ACCEPT);

// The texts of an element as a user reads them: the text of each element in
// it, in order, a dropdown reading as the option it shows. Whitespace is
// normalized, so the narrow no-break space that separates thousands in
// French amounts reads as a plain space.
export function texts(element) {
  const pieces = [];
  let parent = null;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, shownByDropdowns);
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

// The rows of a table, header and footer included, as lists of cell texts
export function rowsOf(table) {
  return [...table.querySelectorAll('tr')].map((row) =>
    [...row.cells].map((cell) => normalize(cell.textContent)));
}

// The rows of a table as lists of the texts they show. Unlike rowsOf(), a
// cell that shows several texts, like a name and its badge, gives each apart,
// and an empty cell gives none.
export function rowTextsOf(table) {
  return [...table.querySelectorAll('tr')].map((row) => texts(row));
}

// The card or panel that shows a label, or holds an element: the page draws
// them as white blocks with rounded corners.
export function cardOf(labelOrElement) {
  const element = typeof labelOrElement === 'string'
    ? screen.getByText(labelOrElement)
    : labelOrElement;
  return element.closest('.rounded-xl');
}

// The row of cards that holds the card showing a label
export function cardRowOf(label) {
  return cardOf(label).parentElement;
}

// The panel a heading heads within a card: the heading with its actions, and
// what shows under it, like the buckets of a Public Cloud project
export function panelOf(heading) {
  return heading.parentElement;
}

// The accordion a button shows or hides: the button, and what shows under it
// once open, like a comparison of the Compare tab
export function accordionOf(toggle) {
  return toggle.parentElement;
}

// A badge of the header: a count and its label
export function headerBadge(label) {
  return screen.getByText(label, { selector: 'span' }).parentElement;
}

// What a summary line shows or hides, like the import history
export function disclosure(summary) {
  return screen.getByText(summary).closest('details');
}

// The dimmed backdrop around a dialog, which closes it on a click
export function backdropOf(dialog) {
  return dialog.parentElement;
}

// The coloured dot of a chart legend item
export function swatchOf(legendItem) {
  return legendItem.querySelector('span');
}
