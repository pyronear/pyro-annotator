import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RequireLocalize from '@/components/routing/RequireLocalize';

let canLocalizeValue = false;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    canLocalize: () => canLocalizeValue,
  }),
}));

beforeEach(() => {
  canLocalizeValue = false;
});

const renderAtLocalize = () =>
  render(
    <MemoryRouter initialEntries={['/localize']}>
      <Routes>
        <Route
          path="/localize"
          element={
            <RequireLocalize>
              <div>localize page</div>
            </RequireLocalize>
          }
        />
        <Route path="/classify" element={<div>classify queue</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('RequireLocalize', () => {
  it('renders the page for users who can localize', () => {
    canLocalizeValue = true;
    renderAtLocalize();

    expect(screen.getByText('localize page')).toBeInTheDocument();
  });

  it('redirects classify-only users to the classify queue', () => {
    renderAtLocalize();

    expect(screen.queryByText('localize page')).not.toBeInTheDocument();
    expect(screen.getByText('classify queue')).toBeInTheDocument();
  });
});
