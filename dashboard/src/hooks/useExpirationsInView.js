import { useEffect, useRef, useState } from 'react';

/**
 * Leads from the header's badge to the Overview's list of the services about to expire (#225):
 * the badge opens the Overview, whatever the tab open, as its tab in the tab bar does, then
 * focuses the list, which the browser scrolls into view, and which a screen reader reads from its
 * heading.
 * @param {string} activeTab - The id of the active tab
 * @param {function(string): void} setActiveTab - Opens a tab, by its id
 * @returns {{ showExpirations: function(): void, expirationsRef: { current: ?HTMLElement } }}
 *   What the badge calls, and the ref of the list's card
 */
export function useExpirationsInView(activeTab, setActiveTab) {
  // The list's card, while the Overview shows it
  const expirationsRef = useRef(null);
  // Whether the badge asked for the list, until the Overview shows it
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (!asked || activeTab !== 'overview') return;
    expirationsRef.current?.focus();
    setAsked(false);
  }, [asked, activeTab]);

  const showExpirations = () => {
    setActiveTab('overview');
    setAsked(true);
  };

  return { showExpirations, expirationsRef };
}
