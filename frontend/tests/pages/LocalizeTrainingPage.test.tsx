import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LocalizeTrainingPage from '@/pages/LocalizeTrainingPage';
import { LOCALIZE_TRAINING_ALERTS } from '@/components/guide/localize-training/trainingAlerts';
import { celebrate } from '@/components/guide/celebrate';
import { apiClient } from '@/services/api';
import { useGuideProgressStore } from '@/store/useGuideProgressStore';

vi.mock('@/components/guide/celebrate', () => ({ celebrate: vi.fn() }));
// The accept popover's loop draws on a canvas jsdom does not have.
vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  default: () => <div data-testid="cropped-loop" />,
}));
vi.mock('@/services/api', () => ({
  apiClient: { getDetectionImageUrl: vi.fn() },
}));

let canLocalizeValue = true;
vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({ canLocalize: () => canLocalizeValue }),
}));

const renderPage = () => render(<LocalizeTrainingPage />, { wrapper: MemoryRouter });

/** Accept every model box on the alert on screen, then submit it. */
const acceptAllAndSubmit = () => {
  fireEvent.click(screen.getByRole('button', { name: /accept object 1's boxes/i }));
  const popover = screen.getByRole('dialog', { name: /accept the model's boxes/i });
  fireEvent.click(within(popover).getByRole('button', { name: /^accept/i }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
};

const next = () =>
  fireEvent.click(screen.getByRole('button', { name: /next alert|see my result/i }));

describe('LocalizeTrainingPage', () => {
  beforeEach(() => {
    canLocalizeValue = true;
    vi.mocked(celebrate).mockClear();
    vi.mocked(apiClient.getDetectionImageUrl).mockClear();
    useGuideProgressStore.setState({ completedByUser: {} });
  });

  it('opens the first alert like the localize page, with submit locked until every frame has a box', () => {
    renderPage();
    expect(screen.getByText(/training · alert 1 of 4/i)).toBeInTheDocument();
    expect(
      screen.getByText(`${LOCALIZE_TRAINING_ALERTS[0].frames.length} frames`)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeDisabled();
  });

  it('marks an alert right when its model boxes were right and accepted', () => {
    renderPage();
    acceptAllAndSubmit();
    const verdict = screen.getByTestId('alert-verdict');
    expect(verdict).toHaveTextContent('Right — every frame matches');
    expect(screen.getAllByTestId('frame-verdict-right')).toHaveLength(
      LOCALIZE_TRAINING_ALERTS[0].frames.length
    );
    expect(screen.queryByTestId('frame-verdict-wrong')).not.toBeInTheDocument();
  });

  it('marks an alert wrong when a wrong model box was accepted, and names the frame', () => {
    renderPage();
    acceptAllAndSubmit();
    next();
    // Alert 2: the model boxes a power line on its last frame.
    acceptAllAndSubmit();
    const verdict = screen.getByTestId('alert-verdict');
    expect(verdict).toHaveTextContent('Not quite');
    expect(verdict).toHaveTextContent(/frame 9 · no smoke on this frame, but a box was kept/i);
    expect(screen.getAllByTestId('frame-verdict-wrong')).toHaveLength(1);
  });

  it('fails a learner who accepts every model box blindly, and offers another go', () => {
    renderPage();
    for (let i = 0; i < LOCALIZE_TRAINING_ALERTS.length; i++) {
      acceptAllAndSubmit();
      next();
    }
    expect(screen.getByRole('heading', { name: 'Your result' })).toBeInTheDocument();
    expect(screen.getAllByTestId('alert-result-wrong')).toHaveLength(2);
    expect(screen.getByText(/you need 3 alerts right out of 4/i)).toBeInTheDocument();
    expect(celebrate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText(/training · alert 1 of 4/i)).toBeInTheDocument();
  });

  it('passes a learner who fixes the wrong boxes, and ticks the module as done', () => {
    renderPage();
    acceptAllAndSubmit();
    next();

    // Alert 2: open the last frame, where the model boxed a power line, and choose None.
    const lastFrame = LOCALIZE_TRAINING_ALERTS[1].frames.at(-1)!.recordedAt;
    fireEvent.click(screen.getByTestId(`alert-frame-cell-${lastFrame}`));
    fireEvent.click(screen.getByTestId('source-row-none'));
    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }));
    acceptAllAndSubmit();
    expect(screen.getByTestId('alert-verdict')).toHaveTextContent('Right — every frame matches');
    next();

    acceptAllAndSubmit();
    next();
    acceptAllAndSubmit(); // alert 4 stays wrong: 3 of 4 is enough
    next();

    expect(screen.getAllByTestId('alert-result-right')).toHaveLength(3);
    expect(screen.getByText("Passed — you're ready to localize!")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /start localizing/i })).toHaveAttribute(
      'href',
      '/localize'
    );
    expect(celebrate).toHaveBeenCalledTimes(1);
    const completed = Object.values(useGuideProgressStore.getState().completedByUser).flat();
    expect(completed).toEqual(['/guide/localization']);
  });

  it('never asks the API for a training image', () => {
    renderPage();
    acceptAllAndSubmit();
    expect(apiClient.getDetectionImageUrl).not.toHaveBeenCalled();
  });
});
