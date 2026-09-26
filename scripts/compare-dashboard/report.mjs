// Compares two captures section by section, and describes each difference as a line diff.

const CONTEXT_LINES = 2;
// Past this many changed lines, a section is shown as replaced as a whole: the diff would
// cost more than it tells
const MAX_EDIT_DISTANCE = 2000;

/**
 * @param {{ sections: Record<string, string> }} base
 * @param {{ sections: Record<string, string> }} head
 * @returns {{ total: number, differences: Array<{ key: string, only?: 'base'|'head',
 *   lines?: number, removed?: number, added?: number, hunks?: string[][] }> }}
 */
export function compareCaptures(base, head) {
  const keys = [...new Set([...Object.keys(base.sections), ...Object.keys(head.sections)])];
  const differences = [];
  for (const key of keys) {
    const before = base.sections[key];
    const after = head.sections[key];
    if (before === after) continue;
    if (after === undefined) {
      differences.push({ key, only: 'base', lines: before.split('\n').length });
    } else if (before === undefined) {
      differences.push({ key, only: 'head', lines: after.split('\n').length });
    } else {
      const ops = diffLines(before.split('\n'), after.split('\n'));
      differences.push({
        key,
        removed: ops.filter(([op]) => op === '-').length,
        added: ops.filter(([op]) => op === '+').length,
        hunks: hunks(ops),
      });
    }
  }
  return { total: keys.length, differences };
}

/**
 * The differences as text. A difference already shown for another section, as a CSV
 * export shown again in its modal, is only named.
 * @param {number} [maxLines] lines shown per section, the rest being counted
 */
export function formatDifferences(differences, maxLines = Infinity) {
  const out = [];
  const shown = new Map();
  for (const difference of differences) {
    if (difference.only) {
      out.push(`✗ ${difference.key}: only in ${difference.only} (${difference.lines} lines)`);
      continue;
    }
    const body = difference.hunks.map((hunk) => hunk.join('\n')).join('\n');
    const summary = `${difference.removed} line(s) removed, ${difference.added} added`;
    if (shown.has(body)) {
      out.push(`✗ ${difference.key}: ${summary}, as in ${shown.get(body)}`);
      continue;
    }
    shown.set(body, difference.key);
    out.push(`✗ ${difference.key}: ${summary}`);
    const lines = body.split('\n');
    out.push(...lines.slice(0, maxLines).map((line) => `  ${line}`));
    if (lines.length > maxLines) out.push(`  … ${lines.length - maxLines} more lines in the report file`);
  }
  return out.join('\n');
}

/**
 * Line diff (Myers), after setting aside the lines both ends have in common.
 * @returns {Array<[' '|'-'|'+', string]>}
 */
export function diffLines(a, b) {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const middle = shortestEdit(middleA, middleB)
    ?? [...middleA.map((line) => ['-', line]), ...middleB.map((line) => ['+', line])];
  return [
    ...a.slice(0, start).map((line) => [' ', line]),
    ...middle,
    ...a.slice(endA).map((line) => [' ', line]),
  ];
}

// Myers' O(ND) algorithm. Round d keeps the furthest x reached on each diagonal k, for k in
// [-d, d]; backtracking through the rounds gives the edit script. Null when too far apart.
function shortestEdit(a, b) {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const v = new Int32Array(2 * max + 2);
  const trace = [];
  for (let d = 0; d <= Math.min(max, MAX_EDIT_DISTANCE); d++) {
    trace.push(v.slice(max - d, max + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[max + k - 1] < v[max + k + 1])
        ? v[max + k + 1]
        : v[max + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[max + k] = x;
      if (x >= n && y >= m) return backtrack(trace, a, b);
    }
  }
  return null;
}

function backtrack(trace, a, b) {
  const ops = [];
  let x = a.length;
  let y = b.length;
  for (let d = trace.length - 1; d >= 0; d--) {
    const at = (k) => trace[d][k + d];
    const k = x - y;
    const previousK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const previousX = d === 0 ? 0 : at(previousK);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      ops.push([' ', a[x - 1]]);
      x--;
      y--;
    }
    if (d > 0) ops.push(x === previousX ? ['+', b[y - 1]] : ['-', a[x - 1]]);
    x = previousX;
    y = previousY;
  }
  return ops.reverse();
}

// The changed lines with a few lines of context, each hunk headed by its line numbers
function hunks(ops) {
  const changed = ops.flatMap(([op], i) => (op === ' ' ? [] : [i]));
  const ranges = [];
  for (const i of changed) {
    const last = ranges.at(-1);
    if (last && i - last.end <= 2 * CONTEXT_LINES + 1) last.end = i;
    else ranges.push({ start: i, end: i });
  }
  // Line numbers, in base and in head, of each op
  const numbers = [];
  let lineA = 1;
  let lineB = 1;
  for (const [op] of ops) {
    numbers.push([lineA, lineB]);
    if (op !== '+') lineA++;
    if (op !== '-') lineB++;
  }
  return ranges.map(({ start, end }) => {
    const from = Math.max(0, start - CONTEXT_LINES);
    const to = Math.min(ops.length - 1, end + CONTEXT_LINES);
    const [baseLine, headLine] = numbers[from];
    return [
      `@@ base line ${baseLine}, head line ${headLine} @@`,
      ...ops.slice(from, to + 1).map(([op, line]) => `${op} ${line}`),
    ];
  });
}
