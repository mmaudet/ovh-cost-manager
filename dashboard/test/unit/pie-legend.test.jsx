import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { PieLegend } from '../../src/components/PieLegend.jsx';

// The amount format of the page, simplified
const fmt = (amount) => amount.toFixed(2);

// The lines of a legend, each as the texts it shows, and the colour of its dot
const linesOf = (legend) => within(legend).getAllByRole('listitem').map((line) => ({
  texts: [...line.querySelectorAll('span')].map((span) => span.textContent).filter(Boolean),
  color: line.querySelector('span').style.backgroundColor,
}));

// Around a pie, the labels leave out the thinnest slices, and hide on a phone: its legend
// names every slice (#226)
describe('PieLegend', () => {
  it('names each slice with its amount and its colour, in the order of the slices', () => {
    render(
      <PieLegend
        label="Répartition par service" fmt={fmt}
        data={[
          { name: 'Compute', value: 800.4, color: '#3b82f6' },
          { name: 'Storage', value: 2.5, color: '#10b981' },
        ]}
      />,
    );

    expect(linesOf(screen.getByRole('list', { name: 'Répartition par service' }))).toEqual([
      { texts: ['Compute', '800.40€'], color: 'rgb(59, 130, 246)' },
      { texts: ['Storage', '2.50€'], color: 'rgb(16, 185, 129)' },
    ]);
  });

  it('reads the name and the amount of a slice from the fields of the pie', () => {
    render(
      <PieLegend
        label="Par modèle GPU" fmt={fmt} nameKey="gpu_model" dataKey="total"
        data={[{ gpu_model: 'NVIDIA L4', total: 420.5, color: '#8b5cf6' }]}
      />,
    );

    expect(linesOf(screen.getByRole('list', { name: 'Par modèle GPU' }))[0].texts)
      .toEqual(['NVIDIA L4', '420.50€']);
  });
});
