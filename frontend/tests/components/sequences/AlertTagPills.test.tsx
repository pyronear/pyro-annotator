import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlertTagPills } from '@/components/sequences/AlertTagPills';

describe('AlertTagPills', () => {
  it('keeps names of 5 characters or fewer whole', () => {
    render(<AlertTagPills tags={['sdis7']} />);
    expect(screen.getByLabelText('sdis7')).toHaveTextContent(/^sdis7sdis7$/);
  });

  it('cuts longer names to 5 characters plus "..." and keeps the full name for hover', () => {
    render(<AlertTagPills tags={['org-alpha']} />);
    const pill = screen.getByLabelText('org-alpha');
    expect(pill).toHaveTextContent('org-a...');
    expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('org-alpha');
  });

  it('renders the empty fallback when the alert has no tag', () => {
    render(<AlertTagPills tags={[]} empty={<span>none</span>} />);
    expect(screen.getByText('none')).toBeInTheDocument();
  });
});
