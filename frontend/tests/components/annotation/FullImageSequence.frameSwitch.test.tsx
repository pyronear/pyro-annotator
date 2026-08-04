/**
 * Reproduction: switching the frame list (an alert switch in the classify
 * cockpit) while the previous frame list's image-URL fetch is still in
 * flight must not leave the player showing the previous alert's images.
 */

import { act, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  apiClient: { getDetectionImageUrl: vi.fn() },
}));

import { apiClient } from '@/services/api';
import FullImageSequence from '@/components/annotation/FullImageSequence';

/** Deferred promise per detection id, so resolution order is controllable. */
function makeDeferredUrls() {
  const resolvers = new Map<number, (v: { url: string }) => void>();
  vi.mocked(apiClient.getDetectionImageUrl).mockImplementation(
    (id: number) => new Promise(resolve => resolvers.set(id, resolve))
  );
  return {
    resolve(id: number) {
      resolvers.get(id)!({ url: `http://img/${id}.jpg` });
    },
    has: (id: number) => resolvers.has(id),
  };
}

const framesFor = (ids: number[]) => ids.map(id => ({ detection_id: id, xyxyn: [0, 0, 1, 1] }));

describe('FullImageSequence frame-list switch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows the new frame list even when the previous fetch resolves last', async () => {
    const urls = makeDeferredUrls();

    const { rerender } = render(<FullImageSequence bboxes={framesFor([1, 2])} sequenceId={101} />);
    await waitFor(() => expect(urls.has(1)).toBe(true));

    // Alert switch: new frame list while alert A's fetch is still pending.
    rerender(<FullImageSequence bboxes={framesFor([3, 4])} sequenceId={301} />);
    await waitFor(() => expect(urls.has(3)).toBe(true));

    // New alert's URLs land first, the stale ones after.
    urls.resolve(3);
    urls.resolve(4);
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument());

    urls.resolve(1);
    urls.resolve(2);
    // Let the stale fetch's `Promise.all` and its state updates flush before
    // asserting — otherwise the assertion passes on the pre-flush DOM.
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(screen.getByRole('img').getAttribute('src')).toMatch(/\/(3|4)\.jpg$/);
  });

  // Guards the invariant `frameKey` exists for: in the classify cockpit every
  // object of an alert plays the same union frame list, so activating another
  // object must NOT refetch 20-40 image URLs. Putting `sequenceId` (or the
  // `bboxes` reference) back into the effect's dependencies would break this
  // while still passing the test above.
  it('does not refetch when only the object changes, not the frame list', async () => {
    makeDeferredUrls();

    const frames = framesFor([1, 2]);
    const { rerender } = render(<FullImageSequence bboxes={frames} sequenceId={101} />);
    await waitFor(() => expect(apiClient.getDetectionImageUrl).toHaveBeenCalledTimes(2));

    // Same frames, different object: new array instance, new lane sequence id.
    rerender(<FullImageSequence bboxes={framesFor([1, 2])} sequenceId={102} color="#00f" />);
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    expect(apiClient.getDetectionImageUrl).toHaveBeenCalledTimes(2);
  });
});
