import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import RequireClassifyTraining from '@/components/routing/RequireClassifyTraining';
import { isGuidePath } from '@/utils/routes';

let canClassifyValue = false;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({ canClassify: () => canClassifyValue }),
}));

beforeEach(() => {
  canClassifyValue = false;
});

const page = (name: string) => (
  <RequireClassifyTraining>
    <div>{name}</div>
  </RequireClassifyTraining>
);

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={page('home page')} />
        <Route path="/classify" element={page('classify queue')} />
        <Route path="/guide" element={page('guide hub')} />
        <Route path="/guide/how-annotation-works" element={page('guide basics')} />
      </Routes>
    </MemoryRouter>
  );

describe('RequireClassifyTraining', () => {
  it('opens the guide by default until the classify training is passed', () => {
    renderAt('/');
    expect(screen.getByText('guide hub')).toBeInTheDocument();
  });

  it('sends any other page to the guide until the classify training is passed', () => {
    renderAt('/classify');
    expect(screen.getByText('guide hub')).toBeInTheDocument();
  });

  it('keeps the guide pages open', () => {
    renderAt('/guide/how-annotation-works');
    expect(screen.getByText('guide basics')).toBeInTheDocument();
  });

  it('lets a user who can classify through', () => {
    canClassifyValue = true;
    renderAt('/classify');
    expect(screen.getByText('classify queue')).toBeInTheDocument();
  });

  it('matches /guide and its sub-pages only', () => {
    expect(isGuidePath('/guide')).toBe(true);
    expect(isGuidePath('/guide/localization')).toBe(true);
    expect(isGuidePath('/guidelines')).toBe(false);
  });
});
