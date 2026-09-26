// Walks through the dashboard in a real browser and captures what it shows: the visible text
// of the shell, of every tab and of every "show all" modal, and the files it exports.

import fs from 'node:fs/promises';
import { chromium } from 'playwright';
import { countAnimationFrames, presetLanguage, readPage, stillFor } from './in-page.mjs';
import { waitFor } from './wait.mjs';

// The labels users see. A pull request that renames one on purpose shows up as a
// difference; update the label here once it is merged.
const TABS = [
  { id: 'overview', label: { fr: "Vue d'ensemble", en: 'Overview' } },
  { id: 'compare', label: { fr: 'Comparaison', en: 'Compare' } },
  { id: 'trends', label: { fr: 'Tendances', en: 'Trends' } },
  { id: 'inventory', label: { fr: 'Public Cloud', en: 'Public Cloud' } },
  { id: 'webcloud', label: { fr: 'Web Cloud', en: 'Web Cloud' } },
  { id: 'infrastructure', label: { fr: 'Infrastructure', en: 'Infrastructure' } },
  { id: 'backup', label: { fr: 'Backup', en: 'Backup' } },
];
// The tabs in the order they are visited, each visit naming its sections.
// - Compare comes a second time after Infrastructure: it only lists the dedicated servers
//   once that tab has loaded their inventory (#35).
// - The overview comes last. When the page opens, or changes month, the loading screen only
//   waits for the summary, so the bar chart mounts before its projects arrive, and a chart
//   axis that mounts without labels measures them at the wrong font size for good. Coming
//   back to the overview mounts its charts again, on data already loaded.
const VISITS = [
  ['compare'], ['trends'], ['inventory'], ['webcloud'], ['infrastructure'],
  ['compare', 'compare-after-infrastructure'], ['backup'], ['overview'],
].map(([id, name = id]) => ({ tab: TABS.find((tab) => tab.id === id), name }));
const SHOW_ALL = { fr: 'Tout afficher', en: 'Show all' };
const LOCALES = { fr: 'fr-FR', en: 'en-US' };
const LANGUAGE_KEY = 'ovh-dashboard-language';
const VIEWPORT = { width: 1440, height: 900 };

// The page has settled once no API call is pending and it has kept still for a few frames,
// charts included: a pie chart only shows its labels at the end of its animation, 1.9 s
// after its data arrives, and first waits 0.4 s without changing anything.
const STILL_FRAMES = 6;
const MAX_FRAMES = 300;
const SETTLE_TIMEOUT = 30_000;
const ACTION_TIMEOUT = 10_000;

// The page gets its API responses one at a time, in the order it asked for them, each one
// once the page has rendered the previous one. Charts measure their labels as they render
// and keep the results for good, measurements leaking into one another: when responses
// race, the charts render in another order, and wrap or hide their axis labels differently.

// Whitespace is all that is normalised: innerText breaks lines and separates cells after
// the layout, not after what the user reads. Only runs of spaces, tabs and line breaks
// collapse: the no-break spaces of amounts (U+00A0, U+202F) are part of their format.
const normalize = (text) => text
  .split('\n')
  .map((line) => line.replace(/[ \t\r]+/g, ' ').replace(/^ | $/g, ''))
  .filter(Boolean)
  .join('\n');

const firstLine = (error) => String(error?.message ?? error).split('\n')[0];

// The page's errors are the one section normalised beyond whitespace: what differs between
// the two sides by construction goes, that is their stacks (only the first line of a message
// is kept), the server's address and the hashed file names of the bundle.
const neutralError = (message) => firstLine(message)
  .replace(/https?:\/\/(127\.0\.0\.1|localhost):\d+/g, '<server>')
  .replace(/\b[\w-]+-[\w-]{8}\.(js|css)\b/g, '<bundle>.$1');

// On a signal, Playwright would close the browser and exit at once, before the worktrees
// and servers are cleaned up: the caller handles signals and closes the browser itself
const LAUNCH_OPTIONS = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };

/**
 * Starts the installed Google Chrome, or else Playwright's Chromium.
 * @returns {Promise<{ browser: import('playwright').Browser, name: string, note?: string }>}
 */
export async function launchBrowser() {
  try {
    return { browser: await chromium.launch({ ...LAUNCH_OPTIONS, channel: 'chrome' }), name: 'Google Chrome' };
  } catch (chromeError) {
    try {
      return {
        browser: await chromium.launch(LAUNCH_OPTIONS),
        name: "Playwright's Chromium",
        note: `Google Chrome did not start (${firstLine(chromeError)}), using Playwright's Chromium.`,
      };
    } catch {
      throw new Error(
        'No browser to drive: install Google Chrome, or Playwright\'s Chromium with '
        + '`npx playwright install chromium`.',
      );
    }
  }
}

/**
 * Captures one dashboard, month by month and language by language.
 *
 * @param {import('playwright').Browser} browser
 * @param {object} options
 * @param {string} options.url             where the dashboard is served
 * @param {Date} options.clock             the time the page sees, frozen
 * @param {string[]} options.languages     'fr', 'en'
 * @param {string[]} options.months        YYYY-MM, picked in the month selector
 * @param {string} options.openingMonth    the month the page opens on: left as is
 * @param {number} options.projects        how many Public Cloud projects to open
 * @param {(step: string, sections: number) => void} [options.onProgress]  after each month
 * @returns {Promise<{ sections: Record<string, string>, failures: string[] }>}
 */
export async function captureDashboard(browser, { url, clock, languages, months, openingMonth, projects, onProgress }) {
  const capture = new Capture();
  for (const language of languages) {
    const context = await browser.newContext({ viewport: VIEWPORT, locale: LOCALES[language] });
    try {
      await context.addInitScript(presetLanguage, { key: LANGUAGE_KEY, value: language });
      // Before the first page load: "today", "N days ago" and the report date stay put
      await context.clock.setFixedTime(clock);
      await context.addInitScript(countAnimationFrames);
      const page = await context.newPage();
      const walker = new Walker(page, { url, language, openingMonth, projects, capture });
      await page.route('**/*', (route) => walker.handle(route));
      for (const month of months) {
        await walker.captureMonth(month);
        onProgress?.(`${language} ${month}`, Object.keys(capture.sections).length);
      }
    } finally {
      await context.close();
    }
  }
  return { sections: capture.sections, failures: capture.failures };
}

/** The captured sections, in capture order, and the steps that failed. */
class Capture {
  sections = {};
  failures = [];

  /** Adds a section. A key already taken gets a number, so nothing is overwritten. */
  add(key, text) {
    let unique = key;
    for (let n = 2; Object.hasOwn(this.sections, unique); n++) unique = `${key} #${n}`;
    this.sections[unique] = text;
    return unique;
  }

  fail(key, error) {
    const message = `capture failed: ${firstLine(error)}`;
    this.failures.push(`${key}: ${message}`);
    this.add(`${key} (failed)`, message);
  }
}

/** Drives one page through the dashboard. */
class Walker {
  constructor(page, { url, language, openingMonth, projects, capture }) {
    Object.assign(this, { page, url, language, openingMonth, projects, capture });
    this.tabLabels = TABS.map((tab) => tab.label[language]);
    this.pending = new Set();
    this.waiting = [];
    this.answering = null;
    // Each error message of the page, with its number of occurrences
    this.errors = new Map();
    const count = (message) => this.errors.set(message, (this.errors.get(message) ?? 0) + 1);
    page.setDefaultTimeout(ACTION_TIMEOUT);
    const isApiCall = (request) => ['xhr', 'fetch'].includes(request.resourceType());
    page.on('request', (request) => { if (isApiCall(request)) this.pending.add(request); });
    page.on('requestfinished', (request) => this.pending.delete(request));
    page.on('requestfailed', (request) => this.pending.delete(request));
    page.on('pageerror', (error) => count(`page error: ${neutralError(error)}`));
    page.on('console', (message) => {
      if (message.type() === 'error') count(`console error: ${neutralError(message.text())}`);
    });
  }

  async captureMonth(month) {
    const prefix = `${this.language}/${month}`;
    this.prefix = prefix;
    this.errors.clear();
    try {
      await this.open(month);
    } catch (error) {
      this.capture.fail(prefix, error);
      return;
    }
    let reload = false;
    for (const [index, { tab, name }] of VISITS.entries()) {
      // After a failure the page may be blank, or covered by a modal
      if (reload) {
        try {
          await this.open(month);
          reload = false;
        } catch (error) {
          for (const skipped of VISITS.slice(index)) {
            this.capture.fail(`${prefix}/${skipped.name}`, `the dashboard did not load again: ${firstLine(error)}`);
          }
          break;
        }
      }
      const key = `${prefix}/${name}`;
      try {
        await this.captureTab(tab, key, prefix);
      } catch (error) {
        this.capture.fail(key, error);
        reload = true;
      }
    }
    // Sorted by message: which errors occurred and how often, not when
    if (this.errors.size) {
      const byMessage = [...this.errors].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      this.capture.add(`${prefix}/errors`, byMessage.map(([message, n]) => `${n} × ${message}`).join('\n'));
    }
  }

  /** Every request of the page: writes are refused, API calls answered in turn. */
  handle(route) {
    const request = route.request();
    const { pathname, search } = new URL(request.url());
    if (request.method() !== 'GET') {
      // The comparison only reads: a resync would call the OVH API, and older commits
      // ignore IMPORT_ENABLED=false, so the page's writes stop here, whatever the code
      const written = `${request.method()} ${pathname}${search}`;
      this.capture.add(`${this.prefix ?? this.language}/refused:${written}`,
        [`refused ${written}`, request.postData() ?? ''].join('\n').trim());
      return route.abort('blockedbyclient');
    }
    if (pathname.startsWith('/api/')) return this.answerInTurn(route);
    return route.continue();
  }

  /** Queues an API call of the page, answered in turn (see STILL_FRAMES). */
  answerInTurn(route) {
    this.waiting.push(route);
    this.answering ??= this.answerAll();
  }

  async answerAll() {
    while (this.waiting.length) {
      const route = this.waiting.shift();
      try {
        await route.fulfill({ response: await route.fetch() });
        await (await route.request().response())?.finished();
        // Rendered once the page keeps still, the chart animations it may start aside
        await this.page.evaluate(stillFor, { frames: STILL_FRAMES, animations: false, maxFrames: MAX_FRAMES });
      } catch {
        // The page went away (a reload), or the server did: the call fails
        await route.abort().catch(() => {});
      }
    }
    this.answering = null;
  }

  /** Loads the page, on a month, with the import history of the footer open. */
  async open(month) {
    // Calls of the page being left
    for (const route of this.waiting.splice(0)) route.abort().catch(() => {});
    this.pending.clear();
    await this.page.goto(this.url);
    // A loading screen shows until the months and the summary are in
    const look = () => this.page.evaluate(readPage, { tabLabels: this.tabLabels });
    await waitFor(async () => (await look()).ok, {
      timeoutMs: SETTLE_TIMEOUT,
      intervalMs: 200,
      failure: async () => `the dashboard did not show up within ${SETTLE_TIMEOUT / 1000} s: `
        + `${(await look()).reason}`,
    });
    if (month !== this.openingMonth) {
      const selector = this.page.locator('select').filter({ has: this.page.locator(`option[value="${month}"]`) }).first();
      await selector.selectOption(month);
      if ((await selector.inputValue()) !== month) throw new Error(`month ${month} could not be selected`);
    }
    const closedHistory = this.page.locator('details:not([open]) > summary');
    for (let i = 0; i < 10 && (await closedHistory.count()); i++) await closedHistory.first().click();
    await this.settle();
  }

  async captureTab(tab, key, prefix) {
    const { tabBar } = await this.read();
    await this.page.locator(tabBar).getByRole('button', { name: tab.label[this.language], exact: true }).click();
    await this.settle();
    const state = await this.read();
    // The shell on every tab: parts of it depend on the tab (the month selector) or on
    // the tabs visited before (the KPI variation reads a Compare query)
    this.capture.add(`${key}/shell`, normalize(state.shell));
    this.capture.add(key, normalize(state.view));
    await this.captureTableActions(key);
    if (tab.id === 'overview') await this.captureReport(prefix);
    if (tab.id === 'compare') await this.expandAll(key);
    // Public Cloud shows a project's panels once it is selected
    if (tab.id === 'inventory') await this.openRows(key, 'project', this.projects, true);
    if (tab.id === 'infrastructure') await this.openRows(key, 'resource-type', Infinity, false);
  }

  /** Every "show all" modal of the tab, with its exports, then the exports of the tab. */
  async captureTableActions(key) {
    const tab = await this.tabLocator();
    if (!tab) return;
    const showAll = tab.getByRole('button', { name: SHOW_ALL[this.language], exact: true });
    const modals = await showAll.count();
    for (let i = 0; i < modals; i++) {
      await showAll.nth(i).click();
      await this.captureModal(key);
    }
    await this.captureExports(tab, key);
  }

  async captureModal(key) {
    const dialog = this.page.getByRole('dialog');
    await dialog.waitFor();
    await this.settle();
    const text = normalize(await dialog.innerText());
    // Named after its title, counts and amounts left out
    const name = text.split('\n')[0].split(' (')[0].trim() || 'untitled';
    const modalKey = this.capture.add(`${key}/modal:${name}`, text);
    await this.captureExports(dialog, modalKey);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await this.settle();
  }

  /** Every CSV export offered in `scope`, a tab or a modal. */
  async captureExports(scope, key) {
    const buttons = scope.getByRole('button', { name: 'CSV', exact: true });
    const count = await buttons.count();
    for (let i = 0; i < count; i++) await this.captureDownload(key, () => buttons.nth(i).click());
  }

  /** The Markdown report of the header's export menu. */
  async captureReport(prefix) {
    const format = this.page.locator('select').filter({ has: this.page.locator('option[value="md"]') });
    await this.captureDownload(prefix, () => format.selectOption('md'));
  }

  /** A file the page downloads, byte for byte: no normalisation. */
  async captureDownload(key, trigger) {
    const [download] = await Promise.all([this.page.waitForEvent('download'), trigger()]);
    const name = download.suggestedFilename();
    const failure = await download.failure();
    if (failure) throw new Error(`download of ${name} failed: ${failure}`);
    this.capture.add(`${key}/export:${name}`, await fs.readFile(await download.path(), 'utf8'));
    await download.delete();
  }

  /** Opens every accordion of the tab. */
  async expandAll(key) {
    const tab = await this.tabLocator();
    if (!tab) return;
    const closed = tab.locator('button[aria-expanded="false"]');
    const count = await closed.count();
    if (!count) return;
    for (let i = 0; i < count; i++) await closed.first().click();
    await this.settle();
    this.capture.add(`${key}/expanded`, normalize((await this.read()).view));
  }

  /** Opens the first rows of the tab (▼) one at a time, and closes each one again (▲). */
  async openRows(key, kind, limit, withTableActions) {
    const { rowLabels } = await this.read();
    const count = Math.min(rowLabels.length, limit);
    for (let i = 0; i < count; i++) {
      const tab = await this.tabLocator();
      await tab.locator('span').filter({ hasText: /^▼$/ }).nth(i).click();
      await this.settle();
      const rowKey = this.capture.add(`${key}/${kind}:${rowLabels[i]}`, normalize((await this.read()).view));
      if (withTableActions) await this.captureTableActions(rowKey);
      await tab.locator('span').filter({ hasText: /^▲$/ }).first().click();
      await this.settle();
    }
  }

  async read() {
    const state = await this.page.evaluate(readPage, { tabLabels: this.tabLabels });
    if (!state.ok) throw new Error(`the dashboard is not shown: ${state.reason}`);
    return state;
  }

  async tabLocator() {
    const { tab } = await this.read();
    return tab ? this.page.locator(tab) : null;
  }

  /** Waits for the API calls to end, then for the page and its charts to keep still. */
  async settle() {
    // A pointer left over a chart would add its tooltip to the text
    await this.page.mouse.move(0, 0);
    const still = { frames: STILL_FRAMES, animations: true, maxFrames: MAX_FRAMES };
    await waitFor(async () => this.pending.size === 0
      && (await this.page.evaluate(stillFor, still))
      && this.pending.size === 0, {
      timeoutMs: SETTLE_TIMEOUT,
      failure: () => `the page was still changing after ${SETTLE_TIMEOUT / 1000} s`,
    });
  }
}
