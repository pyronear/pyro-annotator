/**
 * Sidebar navigation structure tests for AppLayout.
 * Focuses on the Sequences section containing the Groups link with its badge.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react';
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

vi.mock('@/store/useAuthStore', () => ({
  useAuthStore: () => ({
    user: { username: 'tester' },
    logout: vi.fn(),
    isSuperuser: () => false,
  }),
}));

describe('AppLayout sidebar navigation', () => {
  const renderLayout = () =>
    render(
      <MemoryRouter>
        <AppLayout>
          <div>page content</div>
        </AppLayout>
      </MemoryRouter>
    );

  it('renders Groups as a sub-item of the Sequences section with its badge count', () => {
    renderLayout();

    const groupsLink = screen.getByRole('link', { name: /groups/i });
    expect(groupsLink).toHaveAttribute('href', '/sequence-groups');

    const badge = within(groupsLink).getByText('8');
    expect(badge).toHaveAttribute('title', '8 groups need validation');
  });

  it('places Groups first among the Sequences sub-items, after the section header', () => {
    renderLayout();

    const sequencesHeader = screen.getByRole('button', { name: /sequences/i });
    const groupsLink = screen.getByRole('link', { name: /groups/i });
    const annotateLinks = screen.getAllByRole('link', { name: /annotate/i });
    const sequencesAnnotateLink = annotateLinks.find(
      link => link.getAttribute('href') === '/sequences/annotate'
    );

    expect(sequencesAnnotateLink).toBeDefined();
    expect(
      sequencesHeader.compareDocumentPosition(groupsLink) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      groupsLink.compareDocumentPosition(sequencesAnnotateLink!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('does not render a top-level Sequence groups item', () => {
    renderLayout();

    expect(screen.queryByRole('link', { name: /sequence groups/i })).not.toBeInTheDocument();
  });
});
