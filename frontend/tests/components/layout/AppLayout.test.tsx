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

  it('styles the active link with the pine accent and a left bar', () => {
    renderLayoutAt('/classify/groups');

    const groupsLink = screen.getByRole('link', { name: /groups/i });
    expect(groupsLink).toHaveClass('bg-pine-soft', 'text-pine', 'border-pine', 'border-l-[3px]');
    expect(groupsLink).not.toHaveClass('bg-primary-50', 'border-r-4', 'rounded-l-md');
  });

  it('styles inactive links with haze text, ash hover, and a transparent left bar', () => {
    renderLayoutAt('/classify/groups');

    const smokeLink = screen.getByRole('link', { name: /smoke/i });
    expect(smokeLink).toHaveClass(
      'text-haze',
      'hover:bg-ash',
      'hover:text-char',
      'border-transparent',
      'border-l-[3px]',
      'transition-colors',
      'font-body',
      'text-[13px]'
    );
    expect(smokeLink).not.toHaveClass('text-sm');
  });

  it('stacks nav links without vertical gaps between them', () => {
    renderLayoutAt('/classify/groups');

    const groupsLink = screen.getByRole('link', { name: /groups/i });
    expect(groupsLink.parentElement).not.toHaveClass('space-y-1');
  });

  it('lets nav links span the full sidebar width', () => {
    const { container } = renderLayoutAt('/classify/groups');

    const nav = container.querySelector('nav');
    expect(nav).not.toHaveClass('px-2');
  });

  it('renders Groups as a sub-item of the Classify section with its badge count', () => {
    renderLayout();

    const groupsLink = screen.getByRole('link', { name: /groups/i });
    expect(groupsLink).toHaveAttribute('href', '/classify/groups');

    const badge = within(groupsLink).getByText('8');
    expect(badge).toHaveAttribute('title', '8 groups need validation');
  });

  it('places Groups first among the Classify sub-items, after the section header', () => {
    renderLayout();

    const classifyHeader = screen.getByText('Classify');
    const groupsLink = screen.getByRole('link', { name: /groups/i });
    const sequencesLinks = screen.getAllByRole('link', { name: /sequences/i });
    const classifySequencesLink = sequencesLinks.find(
      link => link.getAttribute('href') === '/classify'
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

  it('uses a three-dot icon on the user menu button', () => {
    renderLayout();

    const menuButton = screen.getByRole('button', { name: /open user menu/i });
    expect(menuButton.querySelector('svg.lucide-more-vertical')).toBeInTheDocument();
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

  it('opens the user menu only via the menu button, not the user row', () => {
    renderLayout();

    expect(screen.queryByRole('button', { name: /tester/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /open user menu/i }));

    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });
});

describe('AppLayout detections nav', () => {
  const renderLayout = () =>
    render(
      <MemoryRouter>
        <AppLayout>
          <div>page content</div>
        </AppLayout>
      </MemoryRouter>
    );

  it('points the Localize section queue entry (Smoke) at /localize', () => {
    renderLayout();

    const smokeLink = screen.getByRole('link', { name: /smoke/i });
    expect(smokeLink).toHaveAttribute('href', '/localize');
    // The old entity-named "Annotate" entry is gone from the detections nav.
    expect(screen.queryByRole('link', { name: /^annotate$/i })).not.toBeInTheDocument();
  });
});

describe('AppLayout path-based nav highlighting', () => {
  const renderLayoutAt = (path: string) =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <AppLayout>
          <div>page content</div>
        </AppLayout>
      </MemoryRouter>
    );

  it.each([
    ['/classify', '/classify'],
    ['/classify/42', '/classify'],
    ['/classify/done', '/classify/done'],
    ['/classify/done/42', '/classify/done'],
    ['/classify/groups', '/classify/groups'],
    ['/classify/groups/7', '/classify/groups'],
    ['/localize', '/localize'],
    ['/localize/5', '/localize'],
    ['/localize/5/9', '/localize'],
    ['/localize/done', '/localize/done'],
    ['/localize/done/5', '/localize/done'],
  ])('at %s the single active link is %s', (path, activeHref) => {
    const { container } = renderLayoutAt(path);

    const activeLinks = Array.from(container.querySelectorAll('a')).filter(a =>
      a.className.includes('text-pine')
    );
    expect(activeLinks).toHaveLength(1);
    expect(activeLinks[0]).toHaveAttribute('href', activeHref);
  });
});
