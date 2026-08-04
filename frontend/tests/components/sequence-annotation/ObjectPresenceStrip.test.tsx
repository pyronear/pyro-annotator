/**
 * Tests for ObjectPresenceStrip: a slim, dependency-free presentational
 * strip on the collocated classify screen giving temporal context + a
 * color legend across an alert's objects. One row per object — color
 * swatch + label + a presence bar across the union of the alert's frame
 * timestamps, filled where that object's lane has a detection at that
 * timestamp.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectPresenceStrip } from '@/components/sequence-annotation/ObjectPresenceStrip';

describe('ObjectPresenceStrip', () => {
  const t1 = '2024-01-01T00:00:00.000Z';
  const t2 = '2024-01-01T00:00:01.000Z';
  const t3 = '2024-01-01T00:00:02.000Z';

  it('renders nothing for a single-object alert — no title, no axis', () => {
    const { container } = render(
      <ObjectPresenceStrip
        objects={[{ label: 'Object 1', color: '#3b82f6', timestamps: [t1, t2] }]}
      />
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Object timeline')).not.toBeInTheDocument();
    expect(screen.queryByTestId('presence-axis')).not.toBeInTheDocument();
    expect(screen.queryByTestId('presence-axis-line')).not.toBeInTheDocument();
    expect(screen.queryByText('Frame')).not.toBeInTheDocument();
  });

  it('renders nothing when there are no objects', () => {
    const { container } = render(<ObjectPresenceStrip objects={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders one row per object with correct colors and labels, and fills segments per the frame union', () => {
    render(
      <ObjectPresenceStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', timestamps: [t1, t2] },
          { label: 'Object 2', color: '#f97316', timestamps: [t2, t3] },
        ]}
      />
    );

    expect(screen.getByText('Object timeline')).toBeInTheDocument();
    expect(screen.getByText('Object 1')).toBeInTheDocument();
    expect(screen.getByText('Object 2')).toBeInTheDocument();

    // Object 1: present at t1, t2; absent at t3.
    expect(screen.getByTestId('presence-segment-0-0')).toHaveStyle({ backgroundColor: '#3b82f6' });
    expect(screen.getByTestId('presence-segment-0-1')).toHaveStyle({ backgroundColor: '#3b82f6' });
    expect(screen.getByTestId('presence-segment-0-2')).not.toHaveStyle({
      backgroundColor: '#3b82f6',
    });

    // Object 2: absent at t1; present at t2, t3.
    expect(screen.getByTestId('presence-segment-1-0')).not.toHaveStyle({
      backgroundColor: '#f97316',
    });
    expect(screen.getByTestId('presence-segment-1-1')).toHaveStyle({ backgroundColor: '#f97316' });
    expect(screen.getByTestId('presence-segment-1-2')).toHaveStyle({ backgroundColor: '#f97316' });

    // Union has exactly 3 frames, per object row.
    expect(screen.getAllByTestId(/^presence-segment-0-/)).toHaveLength(3);
    expect(screen.getAllByTestId(/^presence-segment-1-/)).toHaveLength(3);
  });

  it('uses each object color for its swatch', () => {
    render(
      <ObjectPresenceStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', timestamps: [t1] },
          { label: 'Object 2', color: '#f97316', timestamps: [t1] },
        ]}
      />
    );

    expect(screen.getByTestId('object-presence-swatch-0')).toHaveStyle({
      backgroundColor: '#3b82f6',
    });
    expect(screen.getByTestId('object-presence-swatch-1')).toHaveStyle({
      backgroundColor: '#f97316',
    });
  });

  it('orders the frame union chronologically, not lexicographically, for mixed fractional/non-fractional same-second timestamps', () => {
    // Backend serialization mixes forms for the same second: a plain
    // "...:00Z" (0.0s) and a fractional "...:00.500000Z" (0.5s). Lexicographic
    // string sort puts '.' (0x2E) before 'Z' (0x5A), so it would sort the
    // 0.5s timestamp *before* the 0.0s one — wrong. Each timestamp here
    // belongs to its own object so the filled segment's index reveals where
    // the strip actually placed it in the union.
    const zeroSeconds = '2024-01-01T00:00:00Z'; // earliest
    const halfSecond = '2024-01-01T00:00:00.500000Z'; // middle
    const oneSecond = '2024-01-01T00:00:01Z'; // latest

    render(
      <ObjectPresenceStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', timestamps: [zeroSeconds] },
          { label: 'Object 2', color: '#f97316', timestamps: [halfSecond] },
          { label: 'Object 3', color: '#a855f7', timestamps: [oneSecond] },
        ]}
      />
    );

    // Union index 0 = earliest (0.0s) -> Object 1; index 1 = 0.5s -> Object 2;
    // index 2 = latest (1s) -> Object 3.
    expect(screen.getByTestId('presence-segment-0-0')).toHaveStyle({ backgroundColor: '#3b82f6' });
    expect(screen.getByTestId('presence-segment-1-1')).toHaveStyle({ backgroundColor: '#f97316' });
    expect(screen.getByTestId('presence-segment-2-2')).toHaveStyle({ backgroundColor: '#a855f7' });
  });

  it('renders a real axis: hairline, tick marks + numbers at the first/last frame, and a "Frame" axis label', () => {
    // 12 distinct frames, one per object timestamp — enough to exercise the
    // axis's adaptive intermediate-tick step, not just the always-shown ends.
    const frames = Array.from(
      { length: 12 },
      (_, i) => `2024-01-01T00:00:${String(i).padStart(2, '0')}Z`
    );

    render(
      <ObjectPresenceStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', timestamps: frames },
          { label: 'Object 2', color: '#f97316', timestamps: frames },
        ]}
      />
    );

    expect(screen.getByTestId('presence-axis')).toBeInTheDocument();

    // The axis line is a recessive hairline (the `line` token), not styled
    // with any object color.
    const axisLine = screen.getByTestId('presence-axis-line');
    expect(axisLine).toHaveClass('bg-line');
    expect(axisLine).not.toHaveAttribute('style');

    // First frame is always ticked, labeled "1".
    const tick0 = screen.getByTestId('presence-axis-tick-0');
    expect(tick0).toHaveTextContent('1');
    // Last frame (index 11) is always ticked, labeled "12".
    const tick11 = screen.getByTestId('presence-axis-tick-11');
    expect(tick11).toHaveTextContent('12');
    // Tick labels wear a muted text token, never an inline (object) color —
    // text always wears text tokens, per DESIGN.md.
    expect(tick0).toHaveClass('text-haze');
    expect(tick0).not.toHaveAttribute('style');
    expect(tick11).toHaveClass('text-haze');
    expect(tick11).not.toHaveAttribute('style');

    // Not every one of the 12 columns gets a label — intermediate ticks are
    // spaced out, not one per frame.
    expect(screen.queryAllByText(/^\d+$/).length).toBeLessThan(frames.length);

    // The "Frame" axis label renders once, muted, no object color.
    const axisLabel = screen.getByTestId('presence-axis-label');
    expect(axisLabel).toHaveTextContent('Frame');
    expect(axisLabel).toHaveClass('text-haze');
    expect(axisLabel).not.toHaveAttribute('style');

    // A directional arrowhead marker sits at the line's right end, styled
    // with the same recessive `line` token as the axis line — never an
    // object color.
    const axisArrow = screen.getByTestId('presence-axis-arrow');
    expect(axisArrow).toBeInTheDocument();
    expect(axisArrow).toHaveClass('border-l-line');
    expect(axisArrow).not.toHaveAttribute('style');
  });

  it("renders each row as an accessible button and fires onObjectClick with that row's index", () => {
    const onObjectClick = vi.fn();

    render(
      <ObjectPresenceStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', timestamps: [t1] },
          { label: 'Object 2', color: '#f97316', timestamps: [t2] },
        ]}
        onObjectClick={onObjectClick}
      />
    );

    const row0 = screen.getByRole('button', { name: 'Go to Object 1' });
    const row1 = screen.getByRole('button', { name: 'Go to Object 2' });
    expect(row0.tagName).toBe('BUTTON');
    expect(row1.tagName).toBe('BUTTON');

    fireEvent.click(row1);
    expect(onObjectClick).toHaveBeenCalledTimes(1);
    expect(onObjectClick).toHaveBeenCalledWith(1);

    fireEvent.click(row0);
    expect(onObjectClick).toHaveBeenCalledWith(0);
  });

  it('does not throw when a row is clicked without an onObjectClick handler', () => {
    render(
      <ObjectPresenceStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', timestamps: [t1] },
          { label: 'Object 2', color: '#f97316', timestamps: [t2] },
        ]}
      />
    );

    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }))
    ).not.toThrow();
  });
});
