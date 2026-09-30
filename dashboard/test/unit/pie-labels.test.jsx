import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { pieLabel, pieLabelLine } from '../../src/components/pieLabels.jsx';

// What Recharts gives the label and the line of a slice of a pie: its share of the pie among
// them, and the ends of the line, from the slice to its label
const slice = (percent) => ({
  name: 'Compute',
  value: 120,
  percent,
  points: [{ x: 10, y: 10 }, { x: 30, y: 20 }],
  stroke: '#3b82f6',
  fill: 'none',
});

// The labels of the thinnest slices run into those of their neighbours (#226)
describe('pieLabel', () => {
  const label = pieLabel(({ name, value }) => `${name}: ${value}€`);

  it('labels a slice of 3 % of its pie or more', () => {
    expect(label(slice(0.03))).toBe('Compute: 120€');
    expect(label(slice(0.6))).toBe('Compute: 120€');
  });

  it('leaves a thinner slice without a label', () => {
    expect(label(slice(0.029))).toBeNull();
    expect(label(slice(0))).toBeNull();
  });
});

describe('pieLabelLine', () => {
  it('draws the line to the label of a slice that has one, as Recharts does', () => {
    const { container } = render(<svg>{pieLabelLine(slice(0.2))}</svg>);

    const line = container.querySelector('path.recharts-pie-label-line');
    expect(line).toHaveAttribute('d', 'M10,10L30,20');
    expect(line).toHaveAttribute('stroke', '#3b82f6');
  });

  it('draws none to a slice without a label', () => {
    expect(pieLabelLine(slice(0.01))).toBeNull();
  });
});
