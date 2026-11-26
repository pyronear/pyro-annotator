import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RequireGuide from '@/components/routing/RequireGuide';
import type { RightStatus } from '@/types/api';

let classifyStatus: RightStatus = 'training';
let localizeStatus: RightStatus = 'locked';

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    user: { classify_status: classifyStatus, localize_status: localizeStatus },
  }),
}));

beforeEach(() => {
  classifyStatus = 'training';
  localizeStatus = 'locked';
});

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<div>home page</div>} />
        <Route
          path="/guide"
          element={
            <RequireGuide>
              <div>guide hub</div>
            </RequireGuide>
          }
        />
        <Route
          path="/guide/localization"
          element={
            <RequireGuide module="localization">
              <div>localization training</div>
            </RequireGuide>
          }
        />
      </Routes>
    </MemoryRouter>
  );

describe('RequireGuide', () => {
  it('renders the guide while a training is left', () => {
    renderAt('/guide');
    expect(screen.getByText('guide hub')).toBeInTheDocument();
  });

  it('sends a user with both rights granted to the home page', () => {
    classifyStatus = 'granted';
    localizeStatus = 'granted';
    renderAt('/guide');
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('sends a user with localize locked from the localization training back to the hub', () => {
    renderAt('/guide/localization');
    expect(screen.getByText('guide hub')).toBeInTheDocument();
  });

  it('opens the localization training once the localize training is open', () => {
    localizeStatus = 'training';
    renderAt('/guide/localization');
    expect(screen.getByText('localization training')).toBeInTheDocument();
  });
});
