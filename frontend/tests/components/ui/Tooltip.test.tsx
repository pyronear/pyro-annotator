/**
 * The shared hover tooltip. CSS-only, so what a test can actually pin down is
 * the wiring: the tip reaches assistive tech through `aria-describedby`
 * (rather than being an unannounced decoration), it never steals the
 * trigger's accessible name, and it starts hidden.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { Tooltip } from '@/components/ui/Tooltip';

describe('Tooltip', () => {
  it('describes its trigger without renaming it', () => {
    render(
      <Tooltip tip="Commits every pending box.">
        <button type="button" aria-label="Accept boxes">
          Accept
        </button>
      </Tooltip>
    );

    const trigger = screen.getByRole('button', { name: 'Accept boxes' });
    const tip = screen.getByRole('tooltip');

    expect(trigger).toHaveAttribute('aria-describedby', tip.id);
    expect(tip).toHaveTextContent('Commits every pending box.');
  });

  it('keeps the bubble hidden until the trigger is hovered or focused', () => {
    render(
      <Tooltip tip="Explains the action.">
        <button type="button">Do it</button>
      </Tooltip>
    );

    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveClass('hidden');
    expect(tip).toHaveClass('group-hover:block');
    expect(tip).toHaveClass('group-focus-within:block');
  });
});
