/**
 * The shared per-frame strip extracted from LocalizeObjectRow: segment
 * styling per status, click routing (with propagation stopped — classify's
 * row container is itself clickable), and the click-to-seek highlight ring.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectRowTimeline } from '@/components/annotation/ObjectRowTimeline';
import type { ObjectFrameStatus } from '@/utils/annotation/alertLocalizeUtils';

const baseProps = {
  slug: 'object-2',
  label: 'Object 2',
  color: '#3b82f6',
  frameTimestamps: ['t1', 't2', 't3'],
  statusByTimestamp: { t1: 'confirmed', t2: 'pending' } as Record<string, ObjectFrameStatus>,
  onFrameClick: () => {},
};

describe('ObjectRowTimeline', () => {
  it('renders one segment per frame under the preserved testids, styled by status', () => {
    render(<ObjectRowTimeline {...baseProps} />);
    expect(screen.getByTestId('object-timeline-object-2')).toBeInTheDocument();
    // confirmed: solid fill in the object color
    expect(screen.getByTestId('frame-segment-object-2-0')).toHaveStyle({
      backgroundColor: '#3b82f6',
    });
    // pending: faded fill
    expect(screen.getByTestId('frame-segment-object-2-1')).toHaveClass('opacity-40');
    // missing from the map -> absent: no fill
    expect(screen.getByTestId('frame-segment-object-2-2')).not.toHaveStyle({
      backgroundColor: '#3b82f6',
    });
    expect(screen.getByTestId('frame-segment-object-2-2')).toHaveAccessibleName(
      'Object 2, frame 3: absent'
    );
  });

  it('reports clicks as (timestamp, frameIndex) and stops propagation', () => {
    const onFrameClick = vi.fn();
    const containerClick = vi.fn();
    render(
      <div onClick={containerClick}>
        <ObjectRowTimeline {...baseProps} onFrameClick={onFrameClick} />
      </div>
    );
    fireEvent.click(screen.getByTestId('frame-segment-object-2-1'));
    expect(onFrameClick).toHaveBeenCalledWith('t2', 1);
    expect(containerClick).not.toHaveBeenCalled();
  });

  it('rings only the highlighted segment', () => {
    render(<ObjectRowTimeline {...baseProps} highlightIndex={0} />);
    expect(screen.getByTestId('frame-segment-object-2-0')).toHaveClass('animate-pulse');
    expect(screen.getByTestId('frame-segment-object-2-1')).not.toHaveClass('animate-pulse');
  });
});
