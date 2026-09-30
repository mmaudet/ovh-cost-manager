import { describe, it, expect } from 'vitest';
import { translations } from '../../src/i18n/translations.js';
import { holdsMonth, isMonthInProgress, monthLabel } from '../../src/utils/months.js';
import { months } from '../fixtures/calendar.js';

// Whether a months list, as /api/months lists them for the account shown, holds a month: the
// month selected in the header, or a month that the Compare tab compares (#119)

const [september, august, july] = months;
// September as /api/months lists it while it is in progress (#216)
const septemberInProgress = { ...september, inProgress: true };

// The translations of the page in a language, as useLanguage() gives them
const tIn = (language) => (key) => translations[language][key];

describe('holdsMonth', () => {
  it('holds the months of the list', () => {
    expect(holdsMonth(months, september)).toBe(true);
    expect(holdsMonth(months, july)).toBe(true);
  });

  // The months list of another account lists its own copy of each month
  it('knows a month by its value, whatever list it comes from', () => {
    expect(holdsMonth([september, august], { ...august })).toBe(true);
  });

  it('does not hold a month that the list lacks', () => {
    expect(holdsMonth([august, july], september)).toBe(false);
  });

  // While the months list loads, and before a month is selected
  it('holds no month in an empty list, and holds none without a month', () => {
    expect(holdsMonth([], september)).toBe(false);
    expect(holdsMonth(months, null)).toBe(false);
    expect(holdsMonth(months, undefined)).toBe(false);
  });
});

// Whether a month is the month in progress, as the months list marks it (#216)
describe('isMonthInProgress', () => {
  it('tells the month that the list marks in progress, and no other', () => {
    const inProgress = [septemberInProgress, august, july];

    expect(isMonthInProgress(inProgress, september)).toBe(true);
    expect(isMonthInProgress(inProgress, august)).toBe(false);
    expect(isMonthInProgress(months, september)).toBe(false);
  });

  // The page keeps the month it picked while the lists loaded since hold it: the list that the
  // end of an import refreshes no longer marks the month once it billed each recurring service
  it("reads the list's mark, not that of the month picked from an earlier list", () => {
    expect(isMonthInProgress(months, septemberInProgress)).toBe(false);
    expect(isMonthInProgress([septemberInProgress, august], { ...september })).toBe(true);
  });

  // While the months list loads, and before a month is picked, as a month before none
  it('tells none in an empty list, and none without a month', () => {
    expect(isMonthInProgress([], septemberInProgress)).toBe(false);
    expect(isMonthInProgress([septemberInProgress], null)).toBe(false);
    expect(isMonthInProgress([septemberInProgress], undefined)).toBe(false);
  });
});

// A month of the months list as the Compare tab's months A and B name it (#216)
describe('monthLabel', () => {
  it('names the month in progress so, in the language of the page', () => {
    expect(monthLabel(septemberInProgress, 'fr', tIn('fr'))).toBe('Septembre 2026 (en cours)');
    expect(monthLabel(septemberInProgress, 'en', tIn('en')))
      .toBe('September 2026 (in progress)');
  });

  it('names any other month as formatMonthLabel() does', () => {
    expect(monthLabel(august, 'fr', tIn('fr'))).toBe('Août 2026');
    expect(monthLabel(september, 'en', tIn('en'))).toBe('September 2026');
  });
});
