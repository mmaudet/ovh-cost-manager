import { variationPercent } from '../utils/variation.js';

// The sizes of a variation: in a table cell, or the headline one between the totals of the
// months compared
const SIZES = {
  cell: 'px-2 py-1 rounded text-xs font-medium',
  headline: 'px-4 py-2 rounded-full text-lg font-bold',
};

// The variation from one amount to another, as every table and the headline of the Compare
// tab show it: in percent, red when it grows, green otherwise. From 0 € or less, it cannot be
// computed (#65): "—", with a tooltip that says why.
const Variation = ({ from, to, t, size = 'cell' }) => {
  const variation = variationPercent(from, to);
  if (variation === null) {
    return (
      <span className={`${SIZES[size]} text-gray-400`} title={t('variationNotComputable')}>
        —
      </span>
    );
  }
  const colors = variation > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700';
  return (
    <span className={`${SIZES[size]} ${colors}`}>
      {`${variation > 0 ? '+' : ''}${variation.toFixed(1)}%`}
    </span>
  );
};

export { Variation };
