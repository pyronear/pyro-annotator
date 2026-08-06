/**
 * FullImageSequence `seekRequest`: jump the loop to the requested frame,
 * hold it for 2 s with the 200 ms auto-play suspended, then resume from
 * that frame. Out-of-range indexes (frame list changed mid-flight) are
 * ignored.
 */
import { act, render, screen } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  apiClient: {
    getDetectionImageUrl: vi.fn(async (id: number) => ({ url: `https://example.com/${id}.png` })),
  },
}));

import FullImageSequence, { SeekRequest } from '@/components/annotation/FullImageSequence';

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

const frames = [1, 2, 3, 4].map(id => ({ detection_id: id, xyxyn: [0, 0, 1, 1] }));

const shownSrc = () => screen.getByRole('img').getAttribute('src');

async function renderPlayer(seekRequest?: SeekRequest | null) {
  const view = render(
    <FullImageSequence bboxes={frames} sequenceId={101} seekRequest={seekRequest} />
  );
  // Flush URL fetches + Image preloads (microtasks) under fake timers.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
}

describe('FullImageSequence seekRequest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('jumps to the requested frame, holds it 2 s, then resumes the loop from there', async () => {
    const { rerender } = await renderPlayer(null);
    rerender(
      <FullImageSequence bboxes={frames} sequenceId={101} seekRequest={{ index: 2, nonce: 1 }} />
    );
    expect(shownSrc()).toBe('https://example.com/3.png');

    // Still held just before the 2 s mark — the 200 ms loop would otherwise
    // have advanced ~9 times by now.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1800);
    });
    expect(shownSrc()).toBe('https://example.com/3.png');

    // Cross the hold boundary, then one loop tick: resumes from the held frame.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(shownSrc()).toBe('https://example.com/4.png');
  });

  it('ignores an out-of-range index', async () => {
    await renderPlayer({ index: 99, nonce: 1 });
    expect(shownSrc()).toBe('https://example.com/1.png');
  });

  it('re-seeks on a new nonce for the same index', async () => {
    const { rerender } = await renderPlayer({ index: 1, nonce: 1 });
    expect(shownSrc()).toBe('https://example.com/2.png');

    // Let the first hold lapse, then the loop move on (split across act
    // boundaries — the resumed interval only registers once the hold-end
    // state flush lands).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(shownSrc()).not.toBe('https://example.com/2.png');

    rerender(
      <FullImageSequence bboxes={frames} sequenceId={101} seekRequest={{ index: 1, nonce: 2 }} />
    );
    expect(shownSrc()).toBe('https://example.com/2.png');
  });
});
