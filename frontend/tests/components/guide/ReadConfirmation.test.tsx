import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ReadConfirmation from '@/components/guide/ReadConfirmation';
import { celebrate } from '@/components/guide/celebrate';

vi.mock('@/components/guide/celebrate', () => ({ celebrate: vi.fn() }));

type ObserverCallback = (entries: Array<{ isIntersecting: boolean }>) => void;

let observerCallback: ObserverCallback | null = null;
const disconnect = vi.fn();

class FakeIntersectionObserver {
  constructor(callback: ObserverCallback) {
    observerCallback = callback;
  }
  observe() {}
  disconnect() {
    disconnect();
  }
}

const button = () => screen.getByRole('button', { name: 'I have read it' });

describe('ReadConfirmation', () => {
  beforeEach(() => {
    observerCallback = null;
    vi.mocked(celebrate).mockClear();
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays disabled until the end of the page has been seen', () => {
    render(<ReadConfirmation afterConfirm={<p>next</p>} />);
    expect(button()).toBeDisabled();
    expect(screen.getByText(/scroll to the end of the page/i)).toBeInTheDocument();

    act(() => observerCallback?.([{ isIntersecting: false }]));
    expect(button()).toBeDisabled();

    act(() => observerCallback?.([{ isIntersecting: true }]));
    expect(button()).toBeEnabled();
    expect(screen.queryByText(/scroll to the end of the page/i)).not.toBeInTheDocument();
    expect(disconnect).toHaveBeenCalled();
  });

  it('also waits for the page requirement, showing its hint', () => {
    const { rerender } = render(
      <ReadConfirmation
        afterConfirm={<p>next</p>}
        requirement={{ met: false, hint: 'Watch the whole video to confirm.' }}
      />
    );
    act(() => observerCallback?.([{ isIntersecting: true }]));
    expect(button()).toBeDisabled();
    expect(screen.getByText('Watch the whole video to confirm.')).toBeInTheDocument();

    rerender(
      <ReadConfirmation
        afterConfirm={<p>next</p>}
        requirement={{ met: true, hint: 'Watch the whole video to confirm.' }}
      />
    );
    expect(button()).toBeEnabled();
  });

  it('celebrates, turns into a tick and shows the next step', () => {
    render(<ReadConfirmation afterConfirm={<p>Go check the other modules</p>} />);
    act(() => observerCallback?.([{ isIntersecting: true }]));
    fireEvent.click(button());

    expect(celebrate).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'I have read it' })).not.toBeInTheDocument();
    expect(screen.getByTestId('read-tick')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Done — nice work!');
    expect(screen.getByText('Go check the other modules')).toBeInTheDocument();
  });

  it('is enabled at once when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<ReadConfirmation afterConfirm={<p>next</p>} />);
    expect(button()).toBeEnabled();
  });
});
