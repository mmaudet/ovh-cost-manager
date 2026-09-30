import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useActiveTabInView } from '../../src/hooks/useActiveTabInView.js';

const TABS = ['overview', 'compare', 'trends', 'backup', 'carbon'];

// A tab bar as the shell draws it, a button per tab, which keeps the active tab in view
function TabBar({ activeTab }) {
  const tabRef = useActiveTabInView(activeTab);
  return (
    <div data-testid="bar" style={{ paddingLeft: '4px' }}>
      {TABS.map((tab) => <button key={tab} ref={tabRef(tab)}>{tab}</button>)}
    </div>
  );
}

// Places an element between two abscissas, as a layout would: jsdom lays nothing out
const place = (element, left, right) => {
  element.getBoundingClientRect = () => ({
    left, right, top: 0, bottom: 40, width: right - left, height: 40, x: left, y: 0,
  });
};

// A bar 300 px wide, with a padding of 4 px, scrolled by scrollLeft, and its tabs, 100 px wide
// each and 4 px apart: overview from 4 to 104 px, compare from 108 to 208 px… carbon from 420
// to 520 px, while the bar is not scrolled
const layOut = (scrollLeft) => {
  const bar = screen.getByTestId('bar');
  bar.scrollLeft = scrollLeft;
  place(bar, 0, 300);
  TABS.forEach((tab, index) => {
    const left = 4 + index * 104 - scrollLeft;
    place(screen.getByRole('button', { name: tab }), left, left + 100);
  });
  return bar;
};

// The tab bar scrolls sideways on a phone (#226): a link of a tab or the logo can open a tab
// out of its view
describe('useActiveTabInView', () => {
  it('scrolls the bar to a tab past its right edge, clear of its padding', () => {
    const { rerender } = render(<TabBar activeTab="overview" />);
    const bar = layOut(0);

    rerender(<TabBar activeTab="carbon" />);

    // The carbon tab ends 220 px past the bar's right edge, and 224 px past its padding
    expect(bar.scrollLeft).toBe(224);
  });

  it('scrolls the bar back to a tab past its left edge', () => {
    const { rerender } = render(<TabBar activeTab="backup" />);
    const bar = layOut(316);

    rerender(<TabBar activeTab="overview" />);

    // The overview tab starts 316 px before the bar's padding: the bar is back at its start
    expect(bar.scrollLeft).toBe(0);
  });

  it('leaves the bar where it is when the tab shows whole', () => {
    const { rerender } = render(<TabBar activeTab="overview" />);
    const bar = layOut(0);

    rerender(<TabBar activeTab="compare" />);

    expect(bar.scrollLeft).toBe(0);
  });
});
