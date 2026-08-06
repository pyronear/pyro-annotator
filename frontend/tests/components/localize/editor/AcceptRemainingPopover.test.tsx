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
    availableSource: null,
    xyxyn: [0.1, 0.1, 0.2, 0.2],
  },
  {
    recordedAt: t(1),
    detectionId: 102,
    inObject: true,
    run: 'object',
    committedSource: null,
    availableSource: 'auto',
    xyxyn: [0.1, 0.1, 0.2, 0.2],
  },
  {
    recordedAt: t(2),
    detectionId: 103,
    inObject: true,
    run: 'object',
    committedSource: null,
    availableSource: null,
    xyxyn: null,
  },
  {
    recordedAt: t(3),
    detectionId: 999,
    inObject: false,
    run: 'after',
    committedSource: null,
    availableSource: null,
    xyxyn: null,
  },
];

function renderPopover() {
  return render(
    <AcceptRemainingPopover
      objectLabel="Object 2"
      objectColor="#3b82f6"
      sequenceId={9}
      previewBoxes={[
        { detection_id: 101, xyxyn: [0.1, 0.1, 0.2, 0.2] },
        { detection_id: 102, xyxyn: [0.1, 0.1, 0.2, 0.2] },
      ]}
      entries={ENTRIES}
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

    // No card chrome/title inside the popover — just the row.
    expect(screen.queryByText('Object timeline')).not.toBeInTheDocument();
    expect(screen.getByText('Object 2')).toBeInTheDocument();

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

  it('never puts the playhead on a gap frame via a sibling detection id', () => {
    renderPopover();

    // 999 is the absent frame's sibling detection — not part of this lane's
    // loop; the strip must not light it up.
    act(() => reportFrame?.(0, 999));

    expect(screen.queryByTestId('accept-remaining-frame-counter')).not.toBeInTheDocument();
    expect(screen.getByTestId('status-segment-0-3')).not.toHaveAttribute('data-playhead');
  });
});
