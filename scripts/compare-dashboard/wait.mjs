// Polling until a condition holds, shared by the servers and the browser.

import { setTimeout as sleep } from 'node:timers/promises';

/**
 * Resolves with the first truthy value `check` returns, polled every `intervalMs`.
 * @param {() => unknown} check                may be async, and may throw to give up
 * @param {object} options
 * @param {number} options.timeoutMs
 * @param {number} [options.intervalMs]
 * @param {() => string | Promise<string>} options.failure  the error message on timeout
 */
export async function waitFor(check, { timeoutMs, intervalMs = 100, failure }) {
  const start = Date.now();
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() - start > timeoutMs) throw new Error(await failure());
    await sleep(intervalMs);
  }
}
