/**
 * Two concerns, both about the rail row.
 *
 * Selection treatment: the row's frame styling used to branch on `!workable`
 * FIRST, so a non-workable row (a false positive, or an already-localized
 * lane) could never reach the active branch — clicking it drove the media
 * column but the row itself gave no feedback and stayed dimmed while it was
 * the thing being looked at.
 *
 * Metadata: the row is a read-only summary — progress count and status chip,
 * selected or not. The actions (Accept boxes / Reclassify) live in the
 * Frames panel's CTA bar, covered through the page; the row used to swap its
 * metadata for them, which showed the buttons twice on one screen.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('LocalizeObjectRow metadata', () => {
  it('is selectable from the keyboard', () => {
    // The page's Tab cycle moves real focus here; Enter/Space must activate
    // the row for anything else that focuses it (a click, assistive tech).
    const onActivate = vi.fn();
    render(<LocalizeObjectRow {...baseProps} workable onActivate={onActivate} />);

    expect(row()).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(row(), { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(row(), { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('keeps the progress count and status chip when selected', () => {
    // The selected row used to swap these for the Accept/Reclassify pair;
    // those live only in the Frames panel now, so selection changes the
    // row's accent and nothing else.
    render(<LocalizeObjectRow {...baseProps} workable isActive />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByText('0/3')).toBeInTheDocument();
    expect(screen.getByText('3 left')).toBeInTheDocument();
  });

  it('shows the status chip without a progress fraction on a false-positive row', () => {
    // A false positive has no localization work, so a fraction over its
    // frames would be meaningless.
    render(
      <LocalizeObjectRow
        {...baseProps}
        workable={false}
        isFalsePositive
        falsePositiveTypes={['cloud']}
        isActive
      />
    );

    expect(screen.getByText('False positive')).toBeInTheDocument();
    expect(screen.queryByText('0/3')).not.toBeInTheDocument();
  });
});
