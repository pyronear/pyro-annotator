/**
 * Three concerns, all about the rail row.
 *
 * Selection treatment: the row's frame styling used to branch on `!workable`
 * FIRST, so a non-workable row (a false positive, or an already-localized
 * lane) could never reach the active branch — clicking it drove the media
 * column but the row itself gave no feedback and stayed dimmed while it was
 * the thing being looked at.
 *
 * Metadata: the header is a read-only summary — progress count and status
 * chip, selected or not. The actions (Accept boxes / Reclassify) live in the
 * Frames panel's CTA bar, covered through the page.
 *
 * Inline timeline: the standalone Timeline card folded into the row — a
 * per-frame segment bar under the header, one segment per ALERT frame (the
 * shared axis every row receives), each its own button reporting and
 * navigating to that frame.
 */

import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { LocalizeObjectRow } from '@/components/localize';
import { getObjectColor } from '@/utils/annotation/objectColors';
import type { ObjectFrameStatus } from '@/utils/annotation/alertLocalizeUtils';

const T1 = '2026-01-01T00:00:00Z';
const T2 = '2026-01-01T00:01:00Z';
const T3 = '2026-01-01T00:02:00Z';

const baseProps = {
  label: 'Object 2',
  color: getObjectColor(1),
  confirmedCount: 0,
  presentCount: 3,
  frameTimestamps: [T1, T2, T3],
  // T3 deliberately missing from the map -> renders as absent.
  statusByTimestamp: { [T1]: 'confirmed', [T2]: 'pending' } as Record<
    string,
    ObjectFrameStatus
  >,
  onFrameClick: () => {},
  isActive: false,
  onActivate: () => {},
};

const row = () => screen.getByTestId('localize-object-row-object-2');
const header = () => screen.getByRole('button', { name: 'Object 2' });

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
  it('activates from its header, a real button named for the object', () => {
    // The card itself is a container now — it holds the segment buttons, and
    // nesting interactive controls is invalid HTML. The header carries the
    // activation; being a NATIVE button, Enter/Space activation and
    // focusability come from the browser rather than hand-rolled handlers.
    // The page's Tab cycle focuses this button via the forwarded ref.
    const onActivate = vi.fn();
    render(<LocalizeObjectRow {...baseProps} workable onActivate={onActivate} />);

    const headerEl = header();
    expect(headerEl.tagName).toBe('BUTTON');

    fireEvent.click(headerEl);
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('keeps the progress count and status chip when selected', () => {
    // The selected row used to swap these for the Accept/Reclassify pair;
    // those live only in the Frames panel now, so selection changes the
    // row's accent and nothing else.
    render(<LocalizeObjectRow {...baseProps} workable isActive />);

    // Exactly the header + one segment per alert frame — no action buttons.
    expect(within(row()).getAllByRole('button')).toHaveLength(
      1 + baseProps.frameTimestamps.length
    );
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

describe('LocalizeObjectRow inline timeline', () => {
  it('renders one segment per alert frame: confirmed solid, pending faded, unmapped absent', () => {
    render(<LocalizeObjectRow {...baseProps} workable />);

    const color = baseProps.color;
    const confirmed = screen.getByTestId('frame-segment-object-2-0');
    expect(confirmed).toHaveStyle({ backgroundColor: color });
    expect(confirmed).not.toHaveClass('opacity-40');

    const pending = screen.getByTestId('frame-segment-object-2-1');
    expect(pending).toHaveStyle({ backgroundColor: color });
    expect(pending).toHaveClass('opacity-40');

    // T3 has no entry in statusByTimestamp -> neutral track, no inline fill.
    const absent = screen.getByTestId('frame-segment-object-2-2');
    expect(absent).not.toHaveAttribute('style');
  });

  it('renders empty distinctly from pending: outlined in the object color, never filled', () => {
    // empty = on the frame but nothing on it yet. Collapsing it into pending
    // painted a just-added object's whole timeline as if already full.
    render(
      <LocalizeObjectRow
        {...baseProps}
        workable
        statusByTimestamp={{ [T1]: 'empty' } as Record<string, ObjectFrameStatus>}
      />
    );

    const empty = screen.getByTestId('frame-segment-object-2-0');
    expect(empty).toHaveStyle({ boxShadow: `inset 0 0 0 1px ${baseProps.color}` });
    expect(empty).not.toHaveStyle({ backgroundColor: baseProps.color });
  });

  it('reports a segment click with its timestamp, without also activating via the header', () => {
    const onFrameClick = vi.fn();
    const onActivate = vi.fn();
    render(
      <LocalizeObjectRow
        {...baseProps}
        workable
        onFrameClick={onFrameClick}
        onActivate={onActivate}
      />
    );

    fireEvent.click(screen.getByTestId('frame-segment-object-2-1'));

    expect(onFrameClick).toHaveBeenCalledWith(T2);
    // The page's segment handler owns activation (it needs the timestamp to
    // ride in the same navigation); a bubbled onActivate would toggle focus
    // a second time and undo it.
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('names each segment for assistive tech with its frame number and status', () => {
    render(<LocalizeObjectRow {...baseProps} workable />);

    expect(screen.getByTestId('frame-segment-object-2-0')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 1: confirmed'
    );
    expect(screen.getByTestId('frame-segment-object-2-2')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 3: absent'
    );
  });

  it('keeps the strip on a false-positive context row', () => {
    // Parity with the old Timeline card, which included FP rows so the
    // "is that plume already accounted for?" question stays answerable.
    render(
      <LocalizeObjectRow
        {...baseProps}
        workable={false}
        isFalsePositive
        falsePositiveTypes={['cloud']}
      />
    );

    expect(screen.getByTestId('object-timeline-object-2')).toBeInTheDocument();
    expect(screen.getByTestId('frame-segment-object-2-0')).toBeInTheDocument();
  });
});
