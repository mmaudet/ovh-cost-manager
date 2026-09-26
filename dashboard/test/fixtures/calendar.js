// "Today" in every test (see setup.js): Tuesday 15 September 2026, noon in Paris.
export const TODAY = new Date('2026-09-15T10:00:00Z');

// The months the synthetic account was billed, as /api/months lists them:
// most recent first, with labels always in French. The page names the months
// in its own language instead (#33).
export const months = [
  { value: '2026-09', label: 'Septembre 2026', from: '2026-09-01', to: '2026-09-30' },
  { value: '2026-08', label: 'Août 2026', from: '2026-08-01', to: '2026-08-31' },
  { value: '2026-07', label: 'Juillet 2026', from: '2026-07-01', to: '2026-07-31' },
];
