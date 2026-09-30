import { useState } from 'react';
import { readStored, store } from '../utils/storage.js';

// Where the browser keeps whether the page projects the month in progress, next to the language
// and the account selected
const STORAGE_KEY = 'ovh-dashboard-projection';

/**
 * Whether the page projects the month in progress (CONTEXT.md, #214): counts each recurring
 * service that it has not billed yet at its cost of the month before, its projected cost.
 * Page-wide state, which the dashboard shell holds (ADR 0001) and the Trends (#217) and Compare
 * (#218) tabs show as a checkbox. Off by default; the browser remembers it for the next visits,
 * as it does the language and the account selected.
 * @returns {{ projectsMonthInProgress: boolean,
 *   setProjectsMonthInProgress: function(boolean) }} Whether the page projects it, and what turns
 *   the projection on or off
 */
export function useMonthInProgressProjection() {
  // As set on an earlier visit, off without one
  const [projectsMonthInProgress, setProjection] = useState(
    () => readStored(STORAGE_KEY) === 'true',
  );

  const setProjectsMonthInProgress = (projects) => {
    setProjection(projects);
    // Nothing kept while it is off, as by default
    store(STORAGE_KEY, projects ? 'true' : null);
  };

  return { projectsMonthInProgress, setProjectsMonthInProgress };
}
