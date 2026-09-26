// The session of each test, in which the helpers of support/ run their steps: what a test
// leaves running stops once it is over.
//
// A test that fails or times out while a helper waits, such as a renderDashboard() it has
// not awaited yet, leaves the helper running into the next test. Its act() then overlaps
// those of the next test, which React does not support: from then on, React no longer
// renders what the page loads, and every following test of the file fails. And its next
// steps would act on the page of the next test. So each test runs in a session, which
// endTest() closes after it (see setup.js): what the test left running stops at its next
// step, for good.

import { act } from '@testing-library/react';

const openSession = () => ({ over: false, acting: Promise.resolve() });
let session = openSession();
const never = new Promise(() => {});

// The session of the test that runs
export const currentSession = () => session;

// Nothing while the test of the session runs; once it is over, a wait that never ends
export const stopIfOver = (from) => (from.over ? never : undefined);

// Runs callback in act() for the test of the session, unless it is over
export async function actIn(from, callback) {
  await stopIfOver(from);
  // Awaited once only: each then() on what act() returns closes its scope again
  from.acting = (async () => {
    await act(callback);
  })();
  await from.acting;
  await stopIfOver(from);
}

// Closes the session of the test that ran: its act() in progress, if any, ends before the
// next test opens its own, and what the test left running stops
export async function endTest() {
  const ended = session;
  ended.over = true;
  session = openSession();
  await ended.acting.catch(() => {});
}
