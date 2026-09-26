// Functions that Playwright runs inside the dashboard page. It serializes each one on its
// own, so a function may only use what it defines itself: no import, no shared helper.

/**
 * Reads the dashboard as the user sees it.
 *
 * The page is one column of blocks: header, KPI cards, tab bar, active tab and footer. The
 * active tab is the block right after the tab bar, and the shell is all the other blocks.
 * Modals sit outside that column and are read on their own.
 *
 * @param {{ tabLabels: string[] }} options  the labels of the tab buttons, in page order
 * @returns {{ ok: false, reason: string }
 *   | { ok: true, tabBar: string, tab: string|null, shell: string, view: string, rowLabels: string[] }}
 *   the CSS paths of the tab bar and of the active tab, the text of the shell and of the
 *   tab, and the label of every collapsed row (marked ▼) of the tab, in page order
 */
export function readPage({ tabLabels }) {
  // A chart label wraps on several lines (tspan), which innerText glues together. Where it
  // wraps depends on text measurements that Recharts caches across renders, so it varies
  // between page loads: its lines are joined with a space instead, as the user reads them.
  const unwrapChartLabels = (element, rendered) => {
    let done = '';
    let rest = rendered;
    for (const label of element.querySelectorAll('svg text')) {
      const lines = [...label.querySelectorAll('tspan')].map((line) => line.textContent);
      const at = lines.length > 1 ? rest.indexOf(lines.join('')) : -1;
      if (at < 0) continue;
      done += `${rest.slice(0, at)}${lines.join(' ')}`;
      rest = rest.slice(at + lines.join('').length);
    }
    return done + rest;
  };

  // innerText leaves out what form controls show: the selected option, the typed value
  const text = (element) => {
    const controls = [...element.querySelectorAll('select, input, textarea')]
      .filter((control) => control.type !== 'hidden' && control.getClientRects().length > 0)
      .map((control) => (control.tagName === 'SELECT'
        ? `[selected: ${control.selectedOptions[0]?.text ?? ''}]`
        : `[value: ${control.value}]`));
    return [unwrapChartLabels(element, element.innerText), ...controls].join('\n');
  };

  const cssPath = (element) => {
    const steps = [];
    for (let node = element; node && node !== document.body; node = node.parentElement) {
      if (node.id) {
        steps.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      steps.unshift(`${node.localName}:nth-child(${[...node.parentElement.children].indexOf(node) + 1})`);
    }
    return steps.join(' > ');
  };

  const failure = (reason) => {
    const shown = document.body.innerText.trim().replace(/\s+/g, ' ').slice(0, 200);
    return { ok: false, reason: `${reason}; the page shows: ${shown || 'nothing'}` };
  };

  const buttons = [...document.querySelectorAll('button')];
  const tabButtons = tabLabels.map((label) => buttons.find((button) => button.innerText.trim() === label));
  const missing = tabLabels.filter((label, i) => !tabButtons[i]);
  if (missing.length) return failure(`no tab ${missing.map((label) => `"${label}"`).join(', ')}`);
  const tabBar = tabButtons[0].parentElement;
  if (tabButtons.some((button) => button.parentElement !== tabBar)) return failure('the tabs are not in one bar');

  const heading = document.querySelector('h1');
  let column = tabBar.parentElement;
  while (column && !column.contains(heading)) column = column.parentElement;
  if (!column) return failure('no page title');

  const blocks = [...column.children];
  const tabRow = blocks.find((block) => block.contains(tabBar));
  // The last block is the footer: a tab that renders nothing leaves the tab row next to it
  const next = tabRow.nextElementSibling;
  const tab = next && next !== column.lastElementChild ? next : null;

  // A row that opens a detail ends with ▼, and the whole row takes the click (pointer cursor)
  const rowLabels = !tab ? [] : [...tab.querySelectorAll('span')]
    .filter((span) => span.textContent.trim() === '▼')
    .map((span) => {
      let row = span;
      while (row.parentElement !== tab && getComputedStyle(row.parentElement).cursor === 'pointer') {
        row = row.parentElement;
      }
      // The first cell of the first line: a project or resource type name
      return row.innerText.split('\n').map((line) => line.split('\t')[0].trim()).find(Boolean) ?? '';
    });

  return {
    ok: true,
    tabBar: cssPath(tabBar),
    tab: tab && cssPath(tab),
    shell: blocks.filter((block) => block !== tab).map(text).join('\n'),
    view: tab ? text(tab) : '',
    rowLabels,
  };
}

/**
 * Counts the animation frames the page requests (a context init script, added after the
 * frozen clock's, whose timers it keeps).
 */
export function countAnimationFrames() {
  const counter = { requested: 0, request: window.requestAnimationFrame.bind(window) };
  window.__compareDashboardFrames = counter;
  window.requestAnimationFrame = (callback) => {
    counter.requested++;
    return counter.request(callback);
  };
}

/**
 * Resolves true once the page has kept still for `frames` animation frames in a row:
 * nothing changed in the document, and, with `animations`, the page asked for no animation
 * frame either, which is all a chart does while it waits to start its animation. Without
 * `animations`, what chart animations change (SVG attributes) does not count. Resolves
 * false after `maxFrames`. Under the frozen clock, a frame is a 16 ms timer tick.
 */
export function stillFor({ frames, animations, maxFrames }) {
  const counter = window.__compareDashboardFrames;
  return new Promise((resolve) => {
    let changed = false;
    const observer = new MutationObserver((mutations) => {
      if (animations || mutations.some((m) => m.type !== 'attributes' || !(m.target instanceof SVGElement))) {
        changed = true;
      }
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
    let requested = counter.requested;
    let still = 0;
    let elapsed = 0;
    const tick = () => {
      const asked = animations && counter.requested !== requested;
      still = changed || asked ? 0 : still + 1;
      changed = false;
      requested = counter.requested;
      elapsed++;
      if (still >= frames || elapsed >= maxFrames) {
        observer.disconnect();
        resolve(still >= frames);
      } else {
        counter.request(tick);
      }
    };
    counter.request(tick);
  });
}

/** Sets the dashboard language before the page scripts run (a context init script). */
export function presetLanguage({ key, value }) {
  localStorage.setItem(key, value);
}
