import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ReadConfirmation from '@/components/guide/ReadConfirmation';

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

const next = { label: 'Start classifying', to: '/classify' };

const renderConfirmation = () =>
  render(
    <MemoryRouter>
      <ReadConfirmation next={next} />
    </MemoryRouter>
  );

describe('ReadConfirmation', () => {
  beforeEach(() => {
    observerCallback = null;
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('stays disabled until the end of the page has been seen', () => {
    renderConfirmation();
    expect(screen.getByRole('button', { name: 'I have read it' })).toBeDisabled();
    expect(screen.getByText(/scroll to the end of the page/i)).toBeInTheDocument();

    act(() => observerCallback?.([{ isIntersecting: false }]));
    expect(screen.getByRole('button', { name: 'I have read it' })).toBeDisabled();

    act(() => observerCallback?.([{ isIntersecting: true }]));
    expect(screen.getByRole('button', { name: 'I have read it' })).toBeEnabled();
    expect(screen.queryByText(/scroll to the end of the page/i)).not.toBeInTheDocument();
    expect(disconnect).toHaveBeenCalled();
  });

  it('swaps the button for the all-set message and the next step', () => {
    renderConfirmation();
    act(() => observerCallback?.([{ isIntersecting: true }]));
    fireEvent.click(screen.getByRole('button', { name: 'I have read it' }));

    expect(screen.queryByRole('button', { name: 'I have read it' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent("You're all set — start annotating");
    expect(screen.getByRole('link', { name: /start classifying/i })).toHaveAttribute(
      'href',
      '/classify'
    );
  });

  it('is enabled at once when IntersectionObserver is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    renderConfirmation();
    expect(screen.getByRole('button', { name: 'I have read it' })).toBeEnabled();
  });
});
