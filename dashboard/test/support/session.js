// The session of each test, in which the helpers of support/ run their steps: what a test
// leaves running stops once it is over, and fails it.
//
// A test that fails or times out while a helper waits, such as a renderDashboard() it has
// not awaited yet, leaves the helper running into the next test. Its act() then overlaps
// those of the next test, which React does not support: from then on, React no longer
// renders what the page loads, and every following test of the file fails. And its next
// steps would act on the page of the next test. So each test runs in a session, which
// endTest() closes after it (see setup.js): what the test left running stops at its next
// step, for good. A test that passes but did not await a helper, such as passTime(), fails
// there too, rather than pass on a page that was still changing.

import { setImmediate } from 'node:timers';
import { act } from '@testing-library/react';

const openSession = () => ({ over: false, acting: Promise.resolve(), running: [] });
let session = openSession();

// The session of the test that runs
export const currentSession = () => session;

// Nothing while the test of the session runs; once it is over, a wait that never ends
const stopIfOver = (from) => (from.over ? new Promise(() => {}) : undefined);

// Runs a step of a helper for the test of the session, such as an action of its user: named
// in the session until it returns, unless the test is over, when it stops there for good
export async function runStep(from, name, step) {
  from.running.push(name);
  try {
    await stopIfOver(from);
    const result = await step();
    await stopIfOver(from);
    return result;
  } finally {
    from.running.splice(from.running.indexOf(name), 1);
  }
}

// Runs callback in act(), as a step of the test of the session
export function actIn(from, name, callback) {
  return runStep(from, name, async () => {
    // Awaited once only: each then() on what act() returns closes its scope again
    from.acting = (async () => {
      await act(callback);
    })();
    await from.acting;
  });
}

// Closes the session of the test that ran: its act() in progress, if any, ends before the
// next test opens its own, and what the test left running stops. Then fails the test if it
// left anything running: setup.js cleans the page up whatever happens.
export async function endTest() {
  const ended = session;
  ended.over = true;
  session = openSession();
  await ended.acting.catch(() => {});
  // A helper between two of its steps enters the next one, and stops there. Node's own
  // setImmediate(), which fake timers do not replace, lets every promise on its way settle.
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
  if (ended.running.length > 0) {
    throw new Error(`The test ended with ${ended.running.join(', ')} still running: it `
      + 'must await each helper of support/, such as renderDashboard(), openTab() or '
      + 'passTime(), and each action of its user');
  }
}
