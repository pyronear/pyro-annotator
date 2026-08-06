/**
 * The shared swatch+label legend behind LocalizeTimelineLegend and the
 * classify rail's legend: renders exactly the entries given (callers filter
 * to statuses on screen), each under the preserved chip testid; nothing at
 * all for an empty list.
 */
import { render, screen } from '@testing-library/react';
import { TimelineLegend } from '@/components/annotation/TimelineLegend';

describe('TimelineLegend', () => {
  it('renders one chip per entry with the given labels', () => {
    render(
      <TimelineLegend
        testid="classify-timeline-legend"
        entries={[
          { status: 'confirmed', label: 'Detected' },
          { status: 'absent', label: 'Not on this frame' },
        ]}
      />
    );
    const legend = screen.getByTestId('classify-timeline-legend');
    expect(legend).toHaveTextContent('Detected');
    expect(screen.getByTestId('legend-chip-confirmed')).toBeInTheDocument();
    expect(screen.getByTestId('legend-chip-absent')).toHaveTextContent('Not on this frame');
  });

  it('renders nothing for an empty entry list', () => {
    const { container } = render(<TimelineLegend testid="classify-timeline-legend" entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
