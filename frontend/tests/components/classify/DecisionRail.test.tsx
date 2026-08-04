import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DecisionRail } from '@/components/classify';

function renderRail(overrides: Partial<React.ComponentProps<typeof DecisionRail>> = {}) {
  const onMissedSmokeReviewChange = vi.fn();
  const onMissedSmokeActivate = vi.fn();
  render(
    <DecisionRail
      missedSmokeReview={null}
      onMissedSmokeReviewChange={onMissedSmokeReviewChange}
      missedSmokeActive={false}
      onMissedSmokeActivate={onMissedSmokeActivate}
      {...overrides}
    >
      <div data-testid="row-child" />
    </DecisionRail>
  );
  return { onMissedSmokeReviewChange, onMissedSmokeActivate };
}

describe('DecisionRail', () => {
  it('renders children and the missed-smoke row', () => {
    renderRail();
    expect(screen.getByTestId('row-child')).toBeInTheDocument();
    expect(screen.getByText('Missed smoke?')).toBeInTheDocument();
  });

  it('answers yes/no via chips without requiring activation first', () => {
    const { onMissedSmokeReviewChange } = renderRail();
    const row = within(screen.getByTestId('missed-smoke-row'));
    fireEvent.click(row.getByRole('radio', { name: 'No' }));
    expect(onMissedSmokeReviewChange).toHaveBeenCalledWith('no');
    fireEvent.click(row.getByRole('radio', { name: 'Yes' }));
    expect(onMissedSmokeReviewChange).toHaveBeenCalledWith('yes');
  });

  it('reflects the current answer via aria-checked', () => {
    renderRail({ missedSmokeReview: 'no' });
    const row = within(screen.getByTestId('missed-smoke-row'));
    expect(row.getByRole('radio', { name: 'No' })).toBeChecked();
    expect(row.getByRole('radio', { name: 'Yes' })).not.toBeChecked();
  });

  it('clicking the row body activates the missed-smoke section', () => {
    const { onMissedSmokeActivate, onMissedSmokeReviewChange } = renderRail();
    fireEvent.click(screen.getByText('Missed smoke?'));
    expect(onMissedSmokeActivate).toHaveBeenCalled();
    expect(onMissedSmokeReviewChange).not.toHaveBeenCalled();
  });

  it('renders the footer after the missed-smoke row when provided', () => {
    render(
      <DecisionRail
        missedSmokeReview={null}
        onMissedSmokeReviewChange={vi.fn()}
        missedSmokeActive={false}
        onMissedSmokeActivate={vi.fn()}
        footer={<button data-testid="footer-button">Submit</button>}
      >
        <div />
      </DecisionRail>
    );
    const footerButton = screen.getByTestId('footer-button');
    expect(
      screen.getByTestId('missed-smoke-row').compareDocumentPosition(footerButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('is a tab stop: direct focus activates the section, but focusing a chip does not', () => {
    const { onMissedSmokeActivate } = renderRail();
    const row = screen.getByTestId('missed-smoke-row');
    expect(row).toHaveAttribute('tabindex', '0');
    fireEvent.focus(row);
    expect(onMissedSmokeActivate).toHaveBeenCalledTimes(1);
    fireEvent.focus(within(row).getByRole('radio', { name: 'No' }));
    expect(onMissedSmokeActivate).toHaveBeenCalledTimes(1);
  });

  it('disables the chips when missedSmokeDisabled', () => {
    const { onMissedSmokeReviewChange } = renderRail({ missedSmokeDisabled: true });
    const row = within(screen.getByTestId('missed-smoke-row'));
    fireEvent.click(row.getByRole('radio', { name: 'No' }));
    expect(onMissedSmokeReviewChange).not.toHaveBeenCalled();
  });
});
