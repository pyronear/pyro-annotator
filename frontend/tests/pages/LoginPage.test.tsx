import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import LoginPage from '@/pages/LoginPage';

describe('LoginPage', () => {
  it('renders the headline and task-focused tagline', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.getByText('Sign in to PyroAnnotator')).toBeInTheDocument();
    expect(
      screen.getByText('Classify and localize wildfire smoke from Pyronear cameras.')
    ).toBeInTheDocument();
  });

  it('focuses the username field on load', () => {
    render(<LoginPage onLogin={vi.fn()} />);
    expect(screen.getByLabelText('Username')).toHaveFocus();
  });

  it('shows the error message when provided', () => {
    render(<LoginPage onLogin={vi.fn()} error="Invalid username or password" />);
    expect(screen.getByText('Invalid username or password')).toBeInTheDocument();
  });
});
