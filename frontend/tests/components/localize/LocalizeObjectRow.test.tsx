/**
 * Two concerns, both about the rail row.
 *
 * Selection treatment: the row's frame styling used to branch on `!workable`
 * FIRST, so a non-workable row (a false positive, or an already-localized
 * lane) could never reach the active branch — clicking it drove the media
 * column but the row itself gave no feedback and stayed dimmed while it was
 * the thing being looked at.
 *
 * Actions: `Accept boxes` is covered through the page; `Reclassify` is
 * covered here — which rows get it, and that it doesn't double as a row
 * activation.
 *
 * Action visibility: the actions live behind selection, and they take the
 * right-hand metadata's place rather than adding a line — so the rail reads
 * as one column of quiet rows plus whichever one you're working on.
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

// Selected by default: the actions only exist on the selected row, so a
// suite about the actions has to start there.
function renderRow(overrides: Partial<React.ComponentProps<typeof LocalizeObjectRow>> = {}) {
  const onActivate = vi.fn();
  const onReclassify = vi.fn();
  render(
    <LocalizeObjectRow
      label="Object 1"
      color="#E4572E"
      confirmedCount={0}
      presentCount={2}
      workable
      smokeType="wildfire"
      isActive
      onActivate={onActivate}
      onReclassify={onReclassify}
      {...overrides}
    />
  );
  return { onActivate, onReclassify };
}

describe('LocalizeObjectRow reclassify action', () => {
  it('renders Reclassify alongside Accept boxes on a workable row', () => {
    renderRow({ onAcceptBoxes: vi.fn() });

    expect(screen.getByRole('button', { name: 'Reclassify Object 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Accept Object 1's boxes" })).toBeInTheDocument();
  });

  it('calls onReclassify without also activating the row', () => {
    const { onActivate, onReclassify } = renderRow({ onAcceptBoxes: vi.fn() });

    fireEvent.click(screen.getByRole('button', { name: 'Reclassify Object 1' }));

    expect(onReclassify).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('renders Reclassify on an already-localized row, which has no Accept boxes', () => {
    renderRow({ workable: false, onAcceptBoxes: undefined });

    expect(screen.getByRole('button', { name: 'Reclassify Object 1' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
  });

});

describe('LocalizeObjectRow action visibility', () => {
  it('is selectable from the keyboard, since selection now gates the actions', () => {
    // Without this the row is a mouse-only affordance in front of the only
    // copy of these buttons in the rail — the actions would be unreachable
    // by keyboard entirely.
    const { onActivate } = renderRow({ isActive: false, onAcceptBoxes: vi.fn() });
    const row = screen.getByTestId('localize-object-row-object-1');

    expect(row).toHaveAttribute('tabindex', '0');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(row, { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('withholds both actions until the row is selected', () => {
    renderRow({ isActive: false, onAcceptBoxes: vi.fn() });

    expect(screen.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reclassify/ })).not.toBeInTheDocument();
    // What an unselected row says instead: how far along it is.
    expect(screen.getByText('0/2')).toBeInTheDocument();
    expect(screen.getByText('2 left')).toBeInTheDocument();
  });

  it('reveals them in the metadata’s place once selected', () => {
    renderRow({ onAcceptBoxes: vi.fn() });

    expect(screen.getByRole('button', { name: "Accept Object 1's boxes" })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reclassify Object 1' })).toBeInTheDocument();
    // The count and status chip step aside rather than sharing the line —
    // the rail is too narrow to carry both.
    expect(screen.queryByText('0/2')).not.toBeInTheDocument();
    expect(screen.queryByText('2 left')).not.toBeInTheDocument();
  });

  it('swaps a context row’s Localized chip for its one action when selected', () => {
    // The rule is the same past localization: the chip is what the row says
    // at rest, Reclassify is what it offers when you turn to it.
    const { rerender } = render(
      <LocalizeObjectRow
        label="Object 1"
        color="#E4572E"
        confirmedCount={2}
        presentCount={2}
        workable={false}
        isActive={false}
        onActivate={() => {}}
        onReclassify={() => {}}
      />
    );
    expect(screen.getByText('Localized')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reclassify/ })).not.toBeInTheDocument();

    rerender(
      <LocalizeObjectRow
        label="Object 1"
        color="#E4572E"
        confirmedCount={2}
        presentCount={2}
        workable={false}
        isActive
        onActivate={() => {}}
        onReclassify={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Reclassify Object 1' })).toBeInTheDocument();
    expect(screen.queryByText('Localized')).not.toBeInTheDocument();
  });

  it('keeps the status chip on a selected row that has no actions to show', () => {
    // A false positive gets neither action, so there is nothing to swap in —
    // blanking its right side would lose the only thing it says.
    renderRow({
      isActive: true,
      isFalsePositive: true,
      workable: false,
      smokeType: undefined,
      falsePositiveTypes: ['cloud'],
      onAcceptBoxes: undefined,
      onReclassify: undefined,
    });

    expect(screen.getByText('False positive')).toBeInTheDocument();
  });
});

describe('LocalizeObjectRow cropped-view disclosure', () => {
  it('offers no control when the caller withholds the toggle', () => {
    render(<LocalizeObjectRow {...baseProps} workable isActive />);

    expect(screen.queryByRole('button', { name: /cropped view/i })).not.toBeInTheDocument();
  });

  // The right-hand side swaps metadata for actions when a row is selected,
  // and a false positive has no actions to swap in — so a disclosure placed
  // *inside* that swap would vanish on exactly the row whose crop is the
  // reason it's on screen at all.
  it('offers the control on a selected false positive, which has no actions', () => {
    render(
      <LocalizeObjectRow
        {...baseProps}
        workable={false}
        isFalsePositive
        falsePositiveTypes={['cloud']}
        isActive
        onToggleCrop={() => {}}
      />
    );

    expect(
      screen.getByRole('button', { name: "Show Object 2's cropped view" })
    ).toBeInTheDocument();
    // And it doesn't cost the chip, which is all such a row says about itself.
    expect(screen.getByText('False positive')).toBeInTheDocument();
  });

  it('names the action by what the next click does, and reports its state', () => {
    const { rerender } = render(
      <LocalizeObjectRow {...baseProps} workable isActive onToggleCrop={() => {}} />
    );

    const toggle = screen.getByRole('button', { name: "Show Object 2's cropped view" });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    rerender(
      <LocalizeObjectRow {...baseProps} workable isActive onToggleCrop={() => {}} cropExpanded />
    );
    expect(screen.getByRole('button', { name: "Hide Object 2's cropped view" })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('does not activate the row when the toggle is clicked', () => {
    const onActivate = vi.fn();
    const onToggleCrop = vi.fn();
    render(
      <LocalizeObjectRow
        {...baseProps}
        workable
        isActive
        onActivate={onActivate}
        onToggleCrop={onToggleCrop}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: "Show Object 2's cropped view" }));

    expect(onToggleCrop).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  // The row is click-to-activate and activating the ALREADY-active row
  // deselects it — so without a click boundary, using the loop's zoom controls
  // would bounce the object out of focus and unmount the loop mid-interaction.
  it('swallows clicks inside the crop so its own controls never deselect the object', () => {
    const onActivate = vi.fn();
    render(
      <LocalizeObjectRow
        {...baseProps}
        workable
        isActive
        onActivate={onActivate}
        onToggleCrop={() => {}}
        cropExpanded
        crop={<button type="button">Zoom in</button>}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));

    expect(onActivate).not.toHaveBeenCalled();
  });

  // The row's own Enter/Space handler bails when the event didn't start on the
  // row, so the crop needs no keyboard equivalent of the click boundary — but
  // that guard is what makes it safe, so it gets a test.
  it('does not activate the row from a key press inside the crop', () => {
    const onActivate = vi.fn();
    render(
      <LocalizeObjectRow
        {...baseProps}
        workable
        isActive
        onActivate={onActivate}
        onToggleCrop={() => {}}
        cropExpanded
        crop={<button type="button">Zoom in</button>}
      />
    );

    fireEvent.keyDown(screen.getByRole('button', { name: 'Zoom in' }), { key: 'Enter' });

    expect(onActivate).not.toHaveBeenCalled();
  });
});
