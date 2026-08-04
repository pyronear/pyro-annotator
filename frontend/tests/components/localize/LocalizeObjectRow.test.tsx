/**
 * Tests for LocalizeObjectRow's selection treatment. The row's frame styling
 * used to branch on `!workable` FIRST, so a non-workable row (a false
 * positive, or an already-localized context lane) could never reach the
 * active branch: clicking it drove the media column but the row itself gave
 * no feedback and stayed dimmed while it was the thing being looked at.
 */

import { render, screen } from '@testing-library/react';
import { LocalizeObjectRow } from '@/components/localize';
import { getObjectColor } from '@/utils/annotation/objectColors';

const baseProps = {
  label: 'Object 2',
  color: getObjectColor(1),
  confirmedCount: 0,
  presentCount: 3,
  isActive: false,
  onActivate: () => {},
};

const row = () => screen.getByTestId('localize-object-row-object-2');

describe('LocalizeObjectRow selection treatment', () => {
  it('leaves an unselected false-positive row dimmed and unaccented', () => {
    // Dimming is the caller's call now (`dimmed`) rather than derived from
    // `workable`: on a fully localized alert, localized rows are the page's
    // subject and must NOT fade. The page still dims false positives always.
    render(<LocalizeObjectRow {...baseProps} workable={false} isFalsePositive dimmed />);

    expect(row()).toHaveClass('opacity-60');
    expect(row()).not.toHaveClass('border-l-char');
  });

  it('accents a selected false-positive row and lifts the dim', () => {
    render(<LocalizeObjectRow {...baseProps} workable={false} isFalsePositive isActive />);

    // Neutral rather than pine: pine means workable / positive / in progress
    // on this page, which a settled false positive contradicts.
    expect(row()).toHaveClass('border-l-[3px]');
    expect(row()).toHaveClass('border-l-char');
    expect(row()).not.toHaveClass('border-l-pine');
    // Dimming what you are actively looking at contradicts the selection.
    expect(row()).not.toHaveClass('opacity-60');
    expect(row()).toHaveAttribute('data-active', 'true');
  });

  it('accents a selected already-localized context row the same way', () => {
    render(<LocalizeObjectRow {...baseProps} workable={false} isActive />);

    expect(row()).toHaveClass('border-l-char');
    expect(row()).not.toHaveClass('opacity-60');
  });

  it('keeps pine for a selected workable row', () => {
    render(<LocalizeObjectRow {...baseProps} workable isActive />);

    expect(row()).toHaveClass('border-l-pine');
    expect(row()).not.toHaveClass('border-l-char');
  });
});
