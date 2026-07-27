/**
 * Tests for NotificationBadge component.
 */

import { render, screen } from '@testing-library/react';
import NotificationBadge from '@/components/ui/NotificationBadge';

describe('NotificationBadge', () => {
  it('renders nothing when count is zero', () => {
    const { container } = render(<NotificationBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the count', () => {
    render(<NotificationBadge count={7} />);
    expect(screen.getByText('7')).toBeInTheDocument();
  });

  it('clamps counts above 999', () => {
    render(<NotificationBadge count={1500} />);
    expect(screen.getByText('999+')).toBeInTheDocument();
  });

  it('uses the default title when none is given', () => {
    render(<NotificationBadge count={3} />);
    expect(screen.getByTitle('3 items need annotation')).toBeInTheDocument();
  });

  it('uses a custom title when provided', () => {
    render(<NotificationBadge count={3} title="3 groups need validation" />);
    expect(screen.getByTitle('3 groups need validation')).toBeInTheDocument();
  });
});
