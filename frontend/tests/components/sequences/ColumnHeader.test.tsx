/**
 * Tests for ColumnHeader: tooltip rendering, and the optional sortable
 * variant (button, active arrow, aria-sort).
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColumnHeader } from '@/components/sequences/ColumnHeader';

function renderInTable(children: React.ReactNode) {
  return render(
    <table>
      <thead>
        <tr>{children}</tr>
      </thead>
    </table>
  );
}

describe('ColumnHeader', () => {
  it('renders the label and tooltip', () => {
    renderInTable(<ColumnHeader label="Camera" tip="Camera that recorded the sequence" />);

    expect(screen.getByText('Camera')).toBeInTheDocument();
    expect(screen.getByRole('tooltip')).toHaveTextContent('Camera that recorded the sequence');
  });

  it('is a plain header without sort props', () => {
    renderInTable(<ColumnHeader label="Camera" tip="tip" />);

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Camera').closest('th')).not.toHaveAttribute('aria-sort');
  });

  it('renders a sort button that fires onSort', () => {
    const onSort = vi.fn();
    renderInTable(
      <ColumnHeader
        label="Created"
        tip="When the group was created"
        sort={{ active: false, direction: 'desc', onSort }}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /created/i }));
    expect(onSort).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Created').closest('th')).not.toHaveAttribute('aria-sort');
  });

  it('sets aria-sort when active', () => {
    renderInTable(
      <ColumnHeader
        label="Created"
        tip="tip"
        sort={{ active: true, direction: 'asc', onSort: vi.fn() }}
      />
    );

    expect(screen.getByText('Created').closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });
});
