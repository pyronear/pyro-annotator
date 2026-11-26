import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import GuideClassificationPage, { CLASSIFICATION_VIDEO_ID } from '@/pages/GuideClassificationPage';
import { loadYouTubeApi, YT_STATE, type YouTubePlayerOptions } from '@/components/guide/youtube';

vi.mock('@/components/guide/celebrate', () => ({ celebrate: vi.fn() }));

/** A stand-in for the YouTube player whose playhead the test moves. */
class FakePlayer {
  static last: FakePlayer | null = null;
  time = 0;
  duration = 60;
  seekTo = vi.fn((seconds: number) => {
    this.time = seconds;
  });
  destroy = vi.fn();
  constructor(
    public element: HTMLElement,
    public options: YouTubePlayerOptions
  ) {
    FakePlayer.last = this;
  }
  getCurrentTime() {
    return this.time;
  }
  getDuration() {
    return this.duration;
  }
  emit(state: number) {
    this.options.events?.onStateChange?.({ data: state, target: this });
  }
}

vi.mock('@/components/guide/youtube', async importOriginal => ({
  ...(await importOriginal<typeof import('@/components/guide/youtube')>()),
  loadYouTubeApi: vi.fn(),
}));

const button = () => screen.getByRole('button', { name: 'I have read it' });

const renderPage = async () => {
  render(<GuideClassificationPage />, { wrapper: MemoryRouter });
  await waitFor(() => expect(FakePlayer.last).not.toBeNull());
  return FakePlayer.last as FakePlayer;
};

describe('GuideClassificationPage', () => {
  beforeEach(() => {
    FakePlayer.last = null;
    vi.mocked(loadYouTubeApi).mockResolvedValue({
      Player: FakePlayer as unknown as Awaited<ReturnType<typeof loadYouTubeApi>>['Player'],
    });
  });

  it('embeds the YouTube training video', async () => {
    const player = await renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Classification — advanced training' })
    ).toBeInTheDocument();
    expect(player.options.videoId).toBe(CLASSIFICATION_VIDEO_ID);
    expect(player.options.host).toBe('https://www.youtube-nocookie.com');
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
  });

  it('unlocks the confirmation once the video has been played to the end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const player = await renderPage();
    expect(button()).toBeDisabled();
    expect(screen.getByText('Watch the whole video to confirm.')).toBeInTheDocument();

    act(() => player.emit(YT_STATE.PLAYING));
    for (let t = 0.5; t <= 60; t += 0.5) {
      player.time = t;
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }
    act(() => player.emit(YT_STATE.ENDED));

    expect(button()).toBeEnabled();
    expect(screen.getByText(/video watched/i)).toBeInTheDocument();

    fireEvent.click(button());
    expect(screen.getByRole('link', { name: /start classifying/i })).toHaveAttribute(
      'href',
      '/classify'
    );
    vi.useRealTimers();
  });

  it('snaps a jump ahead back and does not count a skipped-to end', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const player = await renderPage();

    act(() => player.emit(YT_STATE.PLAYING));
    // Plays normally up to 5s.
    for (let t = 0.5; t <= 5; t += 0.5) {
      player.time = t;
      act(() => {
        vi.advanceTimersByTime(500);
      });
    }
    // Dragging the playhead to 50s snaps it back to the furthest point played.
    player.time = 50;
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(player.seekTo).toHaveBeenLastCalledWith(5, true);

    // Skipping straight to the end does not unlock the button either.
    player.time = 60;
    act(() => player.emit(YT_STATE.ENDED));
    expect(player.seekTo).toHaveBeenLastCalledWith(5, true);
    expect(button()).toBeDisabled();
    vi.useRealTimers();
  });

  it('offers a YouTube link when the player cannot load', async () => {
    vi.mocked(loadYouTubeApi).mockRejectedValue(new Error('offline'));
    render(<GuideClassificationPage />, { wrapper: MemoryRouter });
    expect(await screen.findByText(/the video could not load/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Classification training video' })).toHaveAttribute(
      'href',
      `https://www.youtube.com/watch?v=${CLASSIFICATION_VIDEO_ID}`
    );
  });
});
