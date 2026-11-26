import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GuideClassificationPage, { CLASSIFICATION_VIDEO_SRC } from '@/pages/GuideClassificationPage';

vi.mock('@/components/guide/celebrate', () => ({ celebrate: vi.fn() }));

const video = () => screen.getByLabelText('Classification training video') as HTMLVideoElement;

function renderPage() {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <GuideClassificationPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe('GuideClassificationPage', () => {
  it('shows the classification training with its video', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { level: 1, name: 'Classification — advanced training' })
    ).toBeInTheDocument();
    expect(video()).toHaveAttribute('src', CLASSIFICATION_VIDEO_SRC);
    expect(screen.queryByText('Coming soon')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to user guide/i })).toHaveAttribute(
      'href',
      '/guide'
    );
  });

  it('unlocks the exercise only once the video has ended, with no read confirmation', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'I have read it' })).not.toBeInTheDocument();
    expect(screen.getByText(/watch the whole video to unlock the exercise/i)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Classification exercise' })).toBeNull();

    fireEvent.ended(video());

    expect(screen.getByRole('region', { name: 'Classification exercise' })).toBeInTheDocument();
    expect(screen.getByText('Alert 1 of 5')).toBeInTheDocument();
  });

  it('does not let the reader skip ahead of what they have watched', () => {
    renderPage();
    const element = video();
    let time = 0;
    Object.defineProperty(element, 'currentTime', {
      get: () => time,
      set: value => {
        time = value;
      },
    });

    time = 5;
    fireEvent.timeUpdate(element);
    // Dragging the playhead to 50s snaps it back to the furthest point played.
    time = 50;
    fireEvent.seeking(element);
    expect(time).toBe(5);
    // Rewinding is free.
    time = 2;
    fireEvent.seeking(element);
    expect(time).toBe(2);
  });
});
