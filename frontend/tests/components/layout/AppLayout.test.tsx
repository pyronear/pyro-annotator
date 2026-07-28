/**
 * Sidebar navigation structure tests for AppLayout.
 * Focuses on the Classify section containing the Groups link with its badge.
 */

import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';

vi.mock('@/hooks/useAnnotationCounts', () => ({
  useAnnotationCounts: () => ({
    sequenceCount: 3,
    detectionCount: 2,
    groupCount: 8,
    isLoading: false,
    error: null,
  }),
}));

let isSuperuserValue = false;

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    user: { username: 'tester' },
    logout: vi.fn(),
    isSuperuser: () => isSuperuserValue,
  }),
}));

beforeEach(() => {
  isSuperuserValue = false;
});

describe('AppLayout sidebar navigation', () => {
  const renderLayout = () =>
    render(
      <MemoryRouter>
        <AppLayout>
          <div>page content</div>
        </AppLayout>
      </MemoryRouter>
    );

  const renderLayoutAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppLayout>
          <div>page content</div>
        </AppLayout>
      </MemoryRouter>
    );

  it('styles the active link with the ember accent and a left bar', () => {
    renderLayoutAt('/sequence-groups');

    const groupsLink = screen.getByRole('link', { name: /groups/i });
    expect(groupsLink).toHaveClass('bg-ember-soft', 'text-ember', 'border-ember', 'border-l-[3px]');
    expect(groupsLink).not.toHaveClass('bg-primary-50', 'border-r-4', 'rounded-l-md');
  });

  it('styles inactive links with haze text, ash hover, and a transparent left bar', () => {
    renderLayoutAt('/sequence-groups');

    const smokeLink = screen.getByRole('link', { name: /smoke/i });
    expect(smokeLink).toHaveClass(
      'text-haze',
      'hover:bg-ash',
      'hover:text-char',
      'border-transparent',
      'border-l-[3px]',
      'transition-colors'
    );
  });

  it('lets nav links span the full sidebar width', () => {
    const { container } = renderLayoutAt('/sequence-groups');

    const nav = container.querySelector('nav');
    expect(nav).not.toHaveClass('px-2');
  });

  it('renders Groups as a sub-item of the Classify section with its badge count', () => {
    renderLayout();

    const groupsLink = screen.getByRole('link', { name: /groups/i });
    expect(groupsLink).toHaveAttribute('href', '/sequence-groups');

    const badge = within(groupsLink).getByText('8');
    expect(badge).toHaveAttribute('title', '8 groups need validation');
  });

  it('places Groups first among the Classify sub-items, after the section header', () => {
    renderLayout();

    const classifyHeader = screen.getByText('Classify');
    const groupsLink = screen.getByRole('link', { name: /groups/i });
    const sequencesLinks = screen.getAllByRole('link', { name: /sequences/i });
    const classifySequencesLink = sequencesLinks.find(
      link => link.getAttribute('href') === '/sequences/annotate'
    );

    expect(classifySequencesLink).toBeDefined();
    expect(
      classifyHeader.compareDocumentPosition(groupsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      groupsLink.compareDocumentPosition(classifySequencesLink!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('does not render a top-level Sequence groups item', () => {
    renderLayout();

    expect(screen.queryByRole('link', { name: /sequence groups/i })).not.toBeInTheDocument();
  });

  it('shows User Management in the user dropdown for superusers', () => {
    isSuperuserValue = true;
    renderLayout();

    fireEvent.click(screen.getByRole('button', { name: /tester/i }));

    const userManagementLink = screen.getByRole('link', { name: /user management/i });
    expect(userManagementLink).toHaveAttribute('href', '/users');
  });

  it('does not show User Management anywhere for regular users', () => {
    renderLayout();

    fireEvent.click(screen.getByRole('button', { name: /tester/i }));

    expect(screen.queryByRole('link', { name: /user management/i })).not.toBeInTheDocument();
  });
});
