/**
 * Tests for OutcomeCode: the compact dot + mono code representing a
 * sequence's model outcome in the done tables.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { OutcomeCode } from '@/components/sequences/OutcomeCode';

describe('OutcomeCode', () => {
  it('renders TP with a pine dot and a descriptive tooltip', () => {
    render(<OutcomeCode outcome="tp" />);

    const code = screen.getByTitle('True positive — model correctly detected smoke');
    expect(code).toHaveTextContent('TP');
    expect(code.querySelector('.bg-pine')).not.toBeNull();
  });

  it('renders FP with a haze dot', () => {
    render(<OutcomeCode outcome="fp" />);

    const code = screen.getByTitle('False positive — model flagged non-smoke');
    expect(code).toHaveTextContent('FP');
    expect(code.querySelector('.bg-haze')).not.toBeNull();
  });

  it('renders FN with the signal flag glyph instead of a dot', () => {
    render(<OutcomeCode outcome="fn" />);

    const code = screen.getByTitle('False negative — smoke was missed');
    expect(code).toHaveTextContent('⚑');
    expect(code).toHaveTextContent('FN');
    expect(code.querySelector('.bg-signal')).toBeNull();
  });

  it('renders unsure as ? with an ember dot', () => {
    render(<OutcomeCode outcome="unsure" />);

    const code = screen.getByTitle('Unsure — needs review');
    expect(code).toHaveTextContent('?');
    expect(code.querySelector('.bg-ember')).not.toBeNull();
  });

  it('renders a muted +N when extraCount is given', () => {
    render(<OutcomeCode outcome="tp" extraCount={2} />);

    expect(screen.getByText('+2')).toBeInTheDocument();
  });

  it('renders no +N when extraCount is absent', () => {
    render(<OutcomeCode outcome="tp" />);

    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });
});
