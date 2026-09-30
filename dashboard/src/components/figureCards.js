// The look of the cards that give a figure: the KPI cards above the tabs, and the cards at the
// top of the tabs, two a row on a phone (#226). Below sm, a tighter padding and a figure one size
// smaller keep their text in the card, and min-w-0 keeps a long figure from widening its column
// of the grid. A card adds its border.

// A card that gives a figure
export const FIGURE_CARD = 'bg-white rounded-xl shadow-sm p-4 sm:p-5 min-w-0';

// The figure of a KPI card
export const KPI_FIGURE = 'text-xl sm:text-2xl font-bold text-gray-900';

// The figure of a card of a tab, a size larger, to which the card adds its colour
export const TAB_FIGURE = 'text-2xl sm:text-3xl font-bold';
