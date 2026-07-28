import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PhaseCard from '@/components/dashboard/PhaseCard';

const props = {
  pass: '01' as const,
  tone: 'ember' as const,
  passLabel: 'Classify',
  title: 'Classify sequences',
  description: 'Watch each sequence and decide: wildfire smoke, other smoke, or false positive.',
  todo: 57,
  done: 453,
  doneNoun: 'classified',
  ctaLabel: 'Start classifying',
  ctaTo: '/sequences/annotate',
  reviewLabel: 'Review classified',
  reviewTo: '/sequences/review',
  isLoading: false,
};

describe('PhaseCard', () => {
  it('renders pass eyebrow, counts, CTA and review link', () => {
    render(<PhaseCard {...props} />, { wrapper: MemoryRouter });
    expect(screen.getByText('Pass 01 — Classify')).toBeInTheDocument();
    expect(screen.getByText('Classify sequences')).toBeInTheDocument();
    expect(screen.getByText('57')).toBeInTheDocument();
    expect(screen.getByText('453 classified so far')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start classifying' })).toHaveAttribute(
      'href',
      '/sequences/annotate'
    );
    expect(screen.getByRole('link', { name: /Review classified/ })).toHaveAttribute(
      'href',
      '/sequences/review'
    );
  });

  it('renders a secondary link when provided and its count is nonzero', () => {
    render(
      <PhaseCard
        {...props}
        secondaryLink={{ label: 'Classify by group', to: '/sequence-groups', count: 12 }}
      />,
      { wrapper: MemoryRouter }
    );
    expect(screen.getByRole('link', { name: /Classify by group/ })).toHaveAttribute(
      'href',
      '/sequence-groups'
    );
  });

  it('hides the secondary link when its count is zero', () => {
    render(
      <PhaseCard
        {...props}
        secondaryLink={{ label: 'Classify by group', to: '/sequence-groups', count: 0 }}
      />,
      { wrapper: MemoryRouter }
    );
    expect(screen.queryByRole('link', { name: /Classify by group/ })).not.toBeInTheDocument();
  });
});
