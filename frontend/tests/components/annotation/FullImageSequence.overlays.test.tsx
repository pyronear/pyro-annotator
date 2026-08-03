/**
 * Tests for FullImageSequence's sibling overlay extension (Task 8, the
 * user-requested full-frame addition): each card's full-frame view also
 * renders sibling objects' boxes, dimmed, in their own colors, aligned by
 * frame `recorded_at` — while its own box uses the object's accent color.
 * CroppedImageSequence is untouched and stays out of scope here.
 */

import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import FullImageSequence from '@/components/annotation/FullImageSequence';
import type { BoundingBox } from '@/types/api';
import type { ObjectOverlay } from '@/utils/annotation/objectColors';

vi.mock('@/services/api', () => ({
  apiClient: {
    getDetectionImageUrl: vi.fn(async (id: number) => ({ url: `https://example.com/${id}.png` })),
  },
}));

// jsdom never actually loads images; make `new Image()` resolve synchronously
// so FullImageSequence's own preloading effects settle without real network.
class ImmediateImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private _src = '';
  set src(value: string) {
    this._src = value;
    queueMicrotask(() => this.onload?.());
  }
  get src() {
    return this._src;
  }
}
vi.stubGlobal('Image', ImmediateImage as unknown as typeof Image);

// Single bbox so FullImageSequence's own 200ms auto-play interval never
// starts (it requires >1 loaded image) — keeps the frame at index 0 for the
// whole test, matching the single frameRecordedAt entry below.
const bboxes: BoundingBox[] = [{ detection_id: 1, xyxyn: [0.1, 0.1, 0.3, 0.3] }];

describe('FullImageSequence sibling overlays', () => {
  it('renders a dimmed sibling box, in the sibling color, on a matching frame', async () => {
    const sibling: ObjectOverlay = {
      color: '#f97316',
      label: 'Object 2',
      boxesByRecordedAt: { t1: [0.4, 0.4, 0.6, 0.6] },
    };

    render(
      <FullImageSequence
        bboxes={bboxes}
        sequenceId={101}
        color="#3b82f6"
        frameRecordedAt={['t1']}
        siblingOverlays={[sibling]}
      />
    );

    await waitFor(() => expect(screen.getByAltText(/Detection/)).toBeInTheDocument());
    fireEvent.load(screen.getByAltText(/Detection/));

    const box = screen.getByTestId('full-sibling-overlay-Object 2');
    expect(box).toHaveStyle({ borderColor: '#f97316' });
    expect(box.className).toContain('opacity');
  });

  it('renders no sibling box when the sibling has no box on this frame', async () => {
    const sibling: ObjectOverlay = {
      color: '#f97316',
      label: 'Object 2',
      boxesByRecordedAt: { 'some-other-frame': [0.4, 0.4, 0.6, 0.6] },
    };

    render(
      <FullImageSequence
        bboxes={bboxes}
        sequenceId={101}
        color="#3b82f6"
        frameRecordedAt={['t1']}
        siblingOverlays={[sibling]}
      />
    );

    await waitFor(() => expect(screen.getByAltText(/Detection/)).toBeInTheDocument());
    fireEvent.load(screen.getByAltText(/Detection/));

    expect(screen.queryByTestId('full-sibling-overlay-Object 2')).not.toBeInTheDocument();
  });

  it("renders its own box in the object's accent color", async () => {
    const { container } = render(
      <FullImageSequence bboxes={bboxes} sequenceId={101} color="#3b82f6" frameRecordedAt={['t1']} />
    );

    await waitFor(() => expect(container.querySelector('img')).toBeInTheDocument());
    fireEvent.load(container.querySelector('img')!);

    const ownBox = container.querySelector('[data-testid="full-own-box"]');
    expect(ownBox).toHaveStyle({ borderColor: '#3b82f6' });
  });
});
