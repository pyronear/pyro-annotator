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

    fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

    const userManagementLink = screen.getByRole('link', { name: /user management/i });
    expect(userManagementLink).toHaveAttribute('href', '/users');
  });

  it('does not show User Management anywhere for regular users', () => {
    renderLayout();

    fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

    expect(screen.queryByRole('link', { name: /user management/i })).not.toBeInTheDocument();
  });

  it('opens the user menu only via the hamburger button, not the user row', () => {
    renderLayout();

    expect(screen.queryByRole('button', { name: /tester/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});
