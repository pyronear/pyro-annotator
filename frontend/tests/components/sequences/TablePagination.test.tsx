/**
 * Tests for TablePagination: label with/without total, hidden when a single
 * page, disabled edges, page-change callbacks.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { TablePagination } from '@/components/sequences/TablePagination';

describe('TablePagination', () => {
  const onPageChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders page info with total and items label', () => {
    render(
      <TablePagination
        page={2}
        pages={5}
        total={230}
        itemsLabel="alerts"
        onPageChange={onPageChange}
      />
    );

    expect(screen.getByText('Page 2 of 5 · 230 alerts')).toBeInTheDocument();
  });

  it('renders page info without total', () => {
    render(<TablePagination page={1} pages={4} onPageChange={onPageChange} />);

    expect(screen.getByText('Page 1 of 4')).toBeInTheDocument();
  });

  it('renders nothing for a single page', () => {
    const { container } = render(<TablePagination page={1} pages={1} onPageChange={onPageChange} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('disables Previous on the first page and Next on the last', () => {
    const { rerender } = render(<TablePagination page={1} pages={3} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeEnabled();

    rerender(<TablePagination page={3} pages={3} onPageChange={onPageChange} />);
    expect(screen.getByRole('button', { name: /previous/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /next/i })).toBeDisabled();
  });

  it('calls onPageChange with the adjacent page', () => {
    render(<TablePagination page={2} pages={3} onPageChange={onPageChange} />);

    fireEvent.click(screen.getByRole('button', { name: /previous/i }));
    expect(onPageChange).toHaveBeenCalledWith(1);

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});
