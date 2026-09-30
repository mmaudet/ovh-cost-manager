import { useEffect, useRef } from 'react';

// Scrolls the tab bar, by as little as it takes, so that a tab of it shows whole, clear of the
// bar's padding. The bar alone: scrollIntoView() would scroll the page to the bar too, down on
// a phone when the logo, above the fold, opens the Overview.
function scrollIntoBar(tab) {
  const bar = tab.parentElement;
  const inset = parseFloat(getComputedStyle(bar).paddingLeft) || 0;
  const barBox = bar.getBoundingClientRect();
  const tabBox = tab.getBoundingClientRect();
  if (tabBox.left < barBox.left + inset) {
    bar.scrollLeft -= barBox.left + inset - tabBox.left;
  } else if (tabBox.right > barBox.right - inset) {
    bar.scrollLeft += tabBox.right - (barBox.right - inset);
  }
}

/**
 * Keeps the active tab in view in the tab bar, which scrolls sideways where it lacks room, as
 * on a phone (#226): whenever the active tab changes, whatever changes it, the tab bar, a link
 * of a tab or the logo, the bar scrolls to it.
 * @param {string} activeTab - The id of the active tab
 * @returns {function(string): function(?HTMLElement)} The ref of the button of a tab, by the
 *   tab's id, for the buttons of the bar
 */
export function useActiveTabInView(activeTab) {
  // The buttons of the bar, by tab
  const buttons = useRef({});

  useEffect(() => {
    const button = buttons.current[activeTab];
    if (button) scrollIntoBar(button);
  }, [activeTab]);

  return (tab) => (button) => {
    buttons.current[tab] = button;
  };
}
