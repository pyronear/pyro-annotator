/**
 * Tests for AcceptRemainingPopover's frame context: the single-object status
 * strip (pre-accept statuses from filmstrip entries), and the frame counter +
 * strip playhead that track the crop loop's reported position.
 *
 * CroppedImageSequence is stubbed: these tests drive `onFrameChange` by hand
 * instead of waiting on image fetches and the 200ms animation interval.
 */

import { act, render, screen } from '@testing-library/react';
import { AcceptRemainingPopover } from '@/components/localize/editor/AcceptRemainingPopover';
import type { FilmstripEntry } from '@/utils/annotation/objectFilmstrip';

let reportFrame: ((index: number, detectionId?: number) => void) | undefined;

vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  default: ({ onFrameChange }: { onFrameChange?: (i: number, id?: number) => void }) => {
    reportFrame = onFrameChange;
    return <div data-testid="loop-stub" />;
  },
}));

const t = (s: number) => `2024-01-01T00:00:0${s}.000Z`;

// Four alert frames: committed, acceptable, gap (in object, no box on
// offer), and a frame the object is absent from (sibling detection id).
const ENTRIES: FilmstripEntry[] = [
  {
    recordedAt: t(0),
    detectionId: 101,
    inObject: true,
    run: 'object',
    committedSource: 'manual',
    cleared: false,
    availableSource: null,
    xyxyn: [0.1, 0.1, 0.2, 0.2],
  },
  {
    recordedAt: t(1),
    detectionId: 102,
    inObject: true,
    run: 'object',
    committedSource: null,
    cleared: false,
    availableSource: 'auto',
    xyxyn: [0.1, 0.1, 0.2, 0.2],
  },
  {
    recordedAt: t(2),
    detectionId: 103,
    inObject: true,
    run: 'object',
    committedSource: null,
    cleared: false,
    availableSource: null,
    xyxyn: null,
  },
  {
    recordedAt: t(3),
    detectionId: 999,
    inObject: false,
    run: 'after',
    committedSource: null,
    cleared: false,
    availableSource: null,
    xyxyn: null,
  },
];

// Committed, then a mid-run frame the object was never detected on (the
// importer only creates lane detections above threshold), then acceptable.
const ENTRIES_WITH_HOLE: FilmstripEntry[] = [
  ENTRIES[0],
  {
    recordedAt: t(1),
    detectionId: 998,
    inObject: false,
    run: 'object',
    committedSource: null,
    cleared: false,
    availableSource: null,
    xyxyn: null,
  },
  { ...ENTRIES[1], recordedAt: t(2) },
];

function renderPopover(entries: FilmstripEntry[] = ENTRIES) {
  return render(
    <AcceptRemainingPopover
      objectLabel="Object 2"
      objectColor="#3b82f6"
      sequenceId={9}
      previewBoxes={[
        { detection_id: 101, xyxyn: [0.1, 0.1, 0.2, 0.2] },
        { detection_id: 102, xyxyn: [0.1, 0.1, 0.2, 0.2] },
      ]}
      entries={entries}
      acceptCount={1}
      gapCount={1}
      isAccepting={false}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

beforeEach(() => {
  reportFrame = undefined;
});

describe('AcceptRemainingPopover frame context', () => {
  it('renders a bare single-object strip with pre-accept statuses per frame', () => {
    renderPopover();

    // No card chrome/title/label cluster inside the popover — the popover
    // already names the object; just the segments.
    expect(screen.queryByText('Object timeline')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Go to Object 2' })).not.toBeInTheDocument();

    expect(screen.getByTestId('status-segment-0-0')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 1: confirmed'
    );
    expect(screen.getByTestId('status-segment-0-1')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 2: pending'
    );
    expect(screen.getByTestId('status-segment-0-2')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 3: empty'
    );
    expect(screen.getByTestId('status-segment-0-3')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 4: absent'
    );
  });

  it('shows no counter and no playhead before the loop reports a frame', () => {
    renderPopover();

    expect(screen.queryByTestId('accept-remaining-frame-counter')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-segment-0-0')).not.toHaveAttribute('data-playhead');
  });

  it('tracks the reported frame: counter counts alert frames, playhead hits its segment', () => {
    renderPopover();

    // Loop entry 1 is detection 102 — the second of four ALERT frames.
    act(() => reportFrame?.(1, 102));

    expect(screen.getByTestId('accept-remaining-frame-counter')).toHaveTextContent('Frame 2 of 4');
    expect(screen.getByTestId('status-segment-0-1')).toHaveAttribute('data-playhead', 'true');
    expect(screen.getByTestId('status-segment-0-0')).not.toHaveAttribute('data-playhead');
  });

  it('hides the counter and playhead when the reported detection is not in the entries', () => {
    renderPopover();

    act(() => reportFrame?.(0, 424242));

    expect(screen.queryByTestId('accept-remaining-frame-counter')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-segment-0-1')).not.toHaveAttribute('data-playhead');
  });

  it('advertises the Enter shortcut on the confirm button', () => {
    renderPopover();

    const confirm = screen.getByTestId('accept-remaining-confirm');
    // Just "Accept" — the sentence above already carries the count.
    expect(confirm).toHaveTextContent(/^Accept\s*Enter$/);
    expect(confirm.querySelector('kbd')).toHaveTextContent('Enter');
  });

  it('shows a legend naming the segment styles that are actually on the strip', () => {
    renderPopover();

    const legend = screen.getByTestId('accept-remaining-legend');
    expect(legend).toHaveTextContent('committed');
    expect(legend).toHaveTextContent('model box to accept');
    expect(legend).toHaveTextContent('no box');
  });

  it('omits legend entries for statuses no frame has', () => {
    // Only the committed and acceptable frames — no gap.
    renderPopover([ENTRIES[0], ENTRIES[1]]);

    const legend = screen.getByTestId('accept-remaining-legend');
    expect(legend).toHaveTextContent('committed');
    expect(legend).toHaveTextContent('model box to accept');
    expect(legend).not.toHaveTextContent('no box');
  });

  it('flags mid-run frames the object was never detected on as potential gaps', () => {
    renderPopover(ENTRIES_WITH_HOLE);

    expect(screen.getByTestId('status-segment-0-1')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 2: undetected'
    );
    expect(screen.getByTestId('accept-remaining-legend')).toHaveTextContent('potential gap');
    expect(screen.getByTestId('accept-remaining-coverage-warning')).toHaveTextContent(
      '1 inside its run it was never detected on'
    );
  });

  it('nudges to check the frames before and after the object as well', () => {
    // ENTRIES ends with one frame after the object's run and none before.
    renderPopover();

    const warning = screen.getByTestId('accept-remaining-coverage-warning');
    expect(warning).toHaveTextContent('1 after it last appears');
    expect(warning).not.toHaveTextContent('before');
  });

  it('shows no coverage nudge when the object spans every alert frame', () => {
    renderPopover(ENTRIES.slice(0, 3));

    expect(screen.queryByTestId('accept-remaining-coverage-warning')).not.toBeInTheDocument();
    expect(screen.getByTestId('accept-remaining-legend')).not.toHaveTextContent('potential gap');
  });

  it('never puts the playhead on a gap frame via a sibling detection id', () => {
    renderPopover();

    // 999 is the absent frame's sibling detection — not part of this lane's
    // loop; the strip must not light it up.
    act(() => reportFrame?.(0, 999));

    expect(screen.queryByTestId('accept-remaining-frame-counter')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-segment-0-3')).not.toHaveAttribute('data-playhead');
  });

  it('shows a cleared frame as settled, not as one the sweep will fill', () => {
    // Same frame as ENTRIES[1] — an auto box on offer — except the annotator
    // already answered "not visible here". The sweep will pass over it, so
    // the strip must not colour it like one still awaiting a box.
    const cleared: FilmstripEntry = { ...ENTRIES[1], cleared: true };
    renderPopover([ENTRIES[0], cleared]);

    expect(screen.getByTestId('status-segment-0-1')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 2: confirmed'
    );
  });
});
