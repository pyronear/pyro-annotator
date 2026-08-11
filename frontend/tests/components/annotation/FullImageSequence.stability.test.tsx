/**
 * Layout stability: the player's box must reserve its own height instead of
 * inheriting it from whatever the <img> happens to have decoded. Deriving the
 * height from the image collapsed the container to nothing on every
 * not-yet-decoded frame, which resized the whole classify cockpit 5x a second.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getDetectionImageUrl: vi.fn(async (id: number) => ({ url: `https://example.com/${id}.png` })),
  },
}));

import FullImageSequence from '@/components/annotation/FullImageSequence';

// jsdom never actually loads images; make `new Image()` resolve synchronously
// so FullImageSequence's own preloading effects settle without real network.
class ImmediateImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}
vi.stubGlobal('Image', ImmediateImage as unknown as typeof Image);

// A second stub for the loop tests below: decides per URL whether the preload
// resolves, so one frame can be held permanently undecoded.
const stalled = new Set<string>();
class ControlledImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(value: string) {
    if (stalled.has(value)) return;
    queueMicrotask(() => this.onload?.());
  }
}

const frames = [1, 2].map(id => ({ detection_id: id, xyxyn: [0, 0, 1, 1] }));

const viewport = () => screen.getByTestId('full-image-viewport');

async function renderPlayer() {
  const view = render(<FullImageSequence bboxes={frames} sequenceId={101} />);
  // Flush URL fetches + Image preloads (microtasks) under fake timers.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
}

describe('FullImageSequence reserved box', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reserves a 16:9 box before any frame has decoded', async () => {
    await renderPlayer();
    // jsdom fires no load event on the rendered <img>, so nothing has been
    // measured yet — the box must already hold a height regardless.
    expect(parseFloat(viewport().style.aspectRatio)).toBeCloseTo(16 / 9, 4);
  });

  it("locks the box to the first decoded frame's own ratio", async () => {
    await renderPlayer();

    const img = screen.getByRole('img');
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    await act(async () => {
      fireEvent.load(img);
    });

    expect(parseFloat(viewport().style.aspectRatio)).toBeCloseTo(800 / 600, 4);
  });

  it('re-measures when the frame list changes', async () => {
    const { rerender } = await renderPlayer();

    const img = screen.getByRole('img');
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    await act(async () => {
      fireEvent.load(img);
    });
    expect(parseFloat(viewport().style.aspectRatio)).toBeCloseTo(800 / 600, 4);

    // Next alert: a different frame list must not inherit the old ratio.
    rerender(
      <FullImageSequence
        bboxes={[3, 4].map(id => ({ detection_id: id, xyxyn: [0, 0, 1, 1] }))}
        sequenceId={301}
      />
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(parseFloat(viewport().style.aspectRatio)).toBeCloseTo(16 / 9, 4);
  });
});

const fourFrames = [1, 2, 3, 4].map(id => ({ detection_id: id, xyxyn: [0, 0, 1, 1] }));
const shownSrc = () => screen.getByRole('img').getAttribute('src');

describe('FullImageSequence undecoded frames', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stalled.clear();
    vi.stubGlobal('Image', ControlledImage as unknown as typeof Image);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('Image', ImmediateImage as unknown as typeof Image);
  });

  it('steps over a frame whose image has not decoded yet', async () => {
    stalled.add('https://example.com/3.png');

    render(<FullImageSequence bboxes={fourFrames} sequenceId={101} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(shownSrc()).toBe('https://example.com/1.png');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(shownSrc()).toBe('https://example.com/2.png');

    // Frame 3 never decoded: showing it would blank the player for a tick, so
    // the loop steps over it to frame 4 and picks it up if it ever arrives.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(shownSrc()).toBe('https://example.com/4.png');
  });
});
