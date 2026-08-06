/**
 * Tests for ObjectStatusStrip: the tri-state, clickable-segment timeline
 * used by the collocated localize screens. One row per object — color
 * swatch + label (as a button, "Go to Object N") plus a per-frame status
 * bar across the union of the alert's frame timestamps, where each frame
 * segment is itself a button (confirmed/pending/empty/absent fill) firing
 * `onSegmentClick`. Unlike ObjectPresenceStrip, this renders from a single
 * object up.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ObjectStatusStrip } from '@/components/sequence-annotation/ObjectStatusStrip';

describe('ObjectStatusStrip', () => {
  const t1 = '2024-01-01T00:00:00.000Z';
  const t2 = '2024-01-01T00:00:01.000Z';
  const t3 = '2024-01-01T00:00:02.000Z';

  it('renders for a single-object alert (no ≥2 gate)', () => {
    render(
      <ObjectStatusStrip
        objects={[
          {
            label: 'Object 1',
            color: '#3b82f6',
            statusByTimestamp: { [t1]: 'confirmed', [t2]: 'pending' },
          },
        ]}
      />
    );

    expect(screen.getByText('Object timeline')).toBeInTheDocument();
    expect(screen.getByText('Object 1')).toBeInTheDocument();
    expect(screen.getByTestId('status-segment-0-0')).toBeInTheDocument();
    expect(screen.getByTestId('status-segment-0-1')).toBeInTheDocument();
  });

  it('renders nothing when there are no objects', () => {
    const { container } = render(<ObjectStatusStrip objects={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('uses a custom title when provided, and defaults to "Object timeline"', () => {
    const { rerender } = render(
      <ObjectStatusStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', statusByTimestamp: { [t1]: 'confirmed' } },
        ]}
      />
    );
    expect(screen.getByText('Object timeline')).toBeInTheDocument();

    rerender(
      <ObjectStatusStrip
        title="Custom title"
        objects={[
          { label: 'Object 1', color: '#3b82f6', statusByTimestamp: { [t1]: 'confirmed' } },
        ]}
      />
    );
    expect(screen.getByText('Custom title')).toBeInTheDocument();
    expect(screen.queryByText('Object timeline')).not.toBeInTheDocument();
  });

  it('renders empty distinctly from pending: outlined in the object color, never filled', () => {
    render(
      <ObjectStatusStrip
        objects={[
          {
            label: 'Object 1',
            color: '#3b82f6',
            statusByTimestamp: { [t1]: 'pending', [t2]: 'empty' },
          },
        ]}
      />
    );

    // pending = a model box waiting to be accepted -> filled.
    expect(screen.getByTestId('status-segment-0-0')).toHaveStyle({ backgroundColor: '#3b82f6' });

    // empty = on the frame, but nothing on it yet -> outline only, so a
    // just-added object's timeline can't read as already full.
    const empty = screen.getByTestId('status-segment-0-1');
    expect(empty).toHaveStyle({ boxShadow: 'inset 0 0 0 1px #3b82f6' });
    expect(empty).not.toHaveStyle({ backgroundColor: '#3b82f6' });
  });

  it('renders fills: confirmed solid, pending reduced opacity, absent neutral (no inline fill)', () => {
    render(
      <ObjectStatusStrip
        objects={[
          {
            label: 'Object 1',
            color: '#3b82f6',
            statusByTimestamp: { [t1]: 'confirmed', [t2]: 'pending', [t3]: 'absent' },
          },
        ]}
      />
    );

    const confirmed = screen.getByTestId('status-segment-0-0');
    expect(confirmed).toHaveStyle({ backgroundColor: '#3b82f6' });
    expect(confirmed).not.toHaveClass('opacity-40');

    const pending = screen.getByTestId('status-segment-0-1');
    expect(pending).toHaveStyle({ backgroundColor: '#3b82f6' });
    expect(pending).toHaveClass('opacity-40');

    const absent = screen.getByTestId('status-segment-0-2');
    expect(absent).not.toHaveAttribute('style');
  });

  it('treats a missing timestamp entry in statusByTimestamp as absent', () => {
    render(
      <ObjectStatusStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', statusByTimestamp: { [t1]: 'confirmed' } },
          { label: 'Object 2', color: '#f97316', statusByTimestamp: { [t2]: 'confirmed' } },
        ]}
      />
    );

    // Object 1 has no entry for t2 -> frame index 1 -> absent.
    expect(screen.getByTestId('status-segment-0-1')).not.toHaveAttribute('style');
  });

  it('fires onSegmentClick with the object index and the segment timestamp', () => {
    const onSegmentClick = vi.fn();

    render(
      <ObjectStatusStrip
        objects={[
          {
            label: 'Object 1',
            color: '#3b82f6',
            statusByTimestamp: { [t1]: 'confirmed', [t2]: 'pending' },
          },
        ]}
        onSegmentClick={onSegmentClick}
      />
    );

    fireEvent.click(screen.getByTestId('status-segment-0-1'));
    expect(onSegmentClick).toHaveBeenCalledTimes(1);
    expect(onSegmentClick).toHaveBeenCalledWith(0, t2);
  });

  it('does not throw when a segment is clicked without an onSegmentClick handler', () => {
    render(
      <ObjectStatusStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', statusByTimestamp: { [t1]: 'confirmed' } },
        ]}
      />
    );

    expect(() => fireEvent.click(screen.getByTestId('status-segment-0-0'))).not.toThrow();
  });

  it('gives each segment button an accessible label with the object, frame number, and status', () => {
    render(
      <ObjectStatusStrip
        objects={[
          {
            label: 'Object 2',
            color: '#3b82f6',
            statusByTimestamp: { [t1]: 'confirmed', [t2]: 'pending' },
          },
        ]}
      />
    );

    expect(
      screen.getByRole('button', { name: 'Object 2, frame 1: confirmed' })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Object 2, frame 2: pending' })).toBeInTheDocument();
  });

  it("renders the label cluster as an accessible button and fires onObjectClick with that row's index", () => {
    const onObjectClick = vi.fn();

    render(
      <ObjectStatusStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', statusByTimestamp: { [t1]: 'confirmed' } },
          { label: 'Object 2', color: '#f97316', statusByTimestamp: { [t1]: 'confirmed' } },
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
  });

  it('does not throw when the label cluster is clicked without an onObjectClick handler', () => {
    render(
      <ObjectStatusStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', statusByTimestamp: { [t1]: 'confirmed' } },
        ]}
      />
    );

    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }))
    ).not.toThrow();
  });

  it('renders the row wrapper as a div (never a button) to avoid nesting buttons', () => {
    const { container } = render(
      <ObjectStatusStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', statusByTimestamp: { [t1]: 'confirmed' } },
        ]}
      />
    );

    const row = container.querySelector('[data-testid="object-status-row-0"]');
    expect(row).not.toBeNull();
    expect(row?.tagName).toBe('DIV');
    // The row contains buttons (label cluster + segment) but is not itself one.
    expect(row?.querySelectorAll('button').length).toBeGreaterThan(0);
  });

  it('uses each object color for its swatch', () => {
    render(
      <ObjectStatusStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', statusByTimestamp: { [t1]: 'confirmed' } },
          { label: 'Object 2', color: '#f97316', statusByTimestamp: { [t1]: 'confirmed' } },
        ]}
      />
    );

    expect(screen.getByTestId('object-status-swatch-0')).toHaveStyle({
      backgroundColor: '#3b82f6',
    });
    expect(screen.getByTestId('object-status-swatch-1')).toHaveStyle({
      backgroundColor: '#f97316',
    });
  });

  it('orders the frame union chronologically, not lexicographically, for mixed fractional/non-fractional same-second timestamps', () => {
    const zeroSeconds = '2024-01-01T00:00:00Z'; // earliest
    const halfSecond = '2024-01-01T00:00:00.500000Z'; // middle
    const oneSecond = '2024-01-01T00:00:01Z'; // latest

    render(
      <ObjectStatusStrip
        objects={[
          {
            label: 'Object 1',
            color: '#3b82f6',
            statusByTimestamp: {
              [zeroSeconds]: 'confirmed',
              [halfSecond]: 'pending',
              [oneSecond]: 'absent',
            },
          },
        ]}
      />
    );

    // Union index 0 = earliest (0.0s) -> confirmed; index 1 = 0.5s -> pending;
    // index 2 = latest (1s) -> absent.
    expect(screen.getByTestId('status-segment-0-0')).toHaveStyle({ backgroundColor: '#3b82f6' });
    expect(screen.getByTestId('status-segment-0-1')).toHaveClass('opacity-40');
    expect(screen.getByTestId('status-segment-0-2')).not.toHaveAttribute('style');
  });

  it('renders no frame axis (dropped for the localize timeline)', () => {
    const frames = Array.from(
      { length: 12 },
      (_, i) => `2024-01-01T00:00:${String(i).padStart(2, '0')}Z`
    );
    const statusByTimestamp = Object.fromEntries(frames.map(t => [t, 'confirmed' as const]));

    render(
      <ObjectStatusStrip objects={[{ label: 'Object 1', color: '#3b82f6', statusByTimestamp }]} />
    );

    expect(screen.queryByTestId('status-axis')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-axis-line')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-axis-arrow')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-axis-tick-0')).not.toBeInTheDocument();
    expect(screen.queryByTestId('status-axis-label')).not.toBeInTheDocument();
  });

  it('gives a selected object row an unmistakable accent treatment, off by default', () => {
    render(
      <ObjectStatusStrip
        objects={[
          { label: 'Object 1', color: '#3b82f6', statusByTimestamp: { [t1]: 'confirmed' } },
          {
            label: 'Object 2',
            color: '#f97316',
            statusByTimestamp: { [t1]: 'confirmed' },
            selected: true,
          },
        ]}
      />
    );

    const unselectedRow = screen.getByTestId('object-status-row-0');
    expect(unselectedRow).not.toHaveAttribute('data-selected');
    expect(unselectedRow).not.toHaveClass('bg-pine-soft');

    const selectedRow = screen.getByTestId('object-status-row-1');
    expect(selectedRow).toHaveAttribute('data-selected', 'true');
    expect(selectedRow).toHaveClass('bg-pine-soft');
    expect(selectedRow).toHaveClass('border-l-pine');
  });

  it('renders undetected as a neutral outline, distinct from empty and absent', () => {
    render(
      <ObjectStatusStrip
        objects={[
          {
            label: 'Object 1',
            color: '#3b82f6',
            statusByTimestamp: { [t1]: 'undetected', [t2]: 'empty', [t3]: 'absent' },
          },
        ]}
      />
    );

    const undetected = screen.getByTestId('status-segment-0-0');
    expect(undetected).toHaveAttribute('aria-label', 'Object 1, frame 1: undetected');
    // Haze outline, not the object's color — nothing of the object is here.
    expect(undetected).toHaveStyle({ boxShadow: 'inset 0 0 0 1px #767B72' });

    // empty keeps the object-color outline; absent stays blank.
    expect(screen.getByTestId('status-segment-0-1')).toHaveStyle({
      boxShadow: 'inset 0 0 0 1px #3b82f6',
    });
    expect(screen.getByTestId('status-segment-0-2')).not.toHaveAttribute('style');
  });

  describe('bare variant', () => {
    it('drops the card chrome, title, and label cluster, keeping the segments', () => {
      const { container } = render(
        <ObjectStatusStrip
          variant="bare"
          objects={[
            {
              label: 'Object 1',
              color: '#3b82f6',
              statusByTimestamp: { [t1]: 'confirmed', [t2]: 'pending' },
            },
          ]}
        />
      );

      expect(screen.queryByText('Object timeline')).not.toBeInTheDocument();
      const root = container.firstElementChild as HTMLElement;
      expect(root.className).not.toContain('border');
      expect(root.className).not.toContain('bg-paper');
      // The embedding surface names the object — no swatch/label cluster.
      expect(screen.queryByText('Object 1')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Go to Object 1' })).not.toBeInTheDocument();
      expect(screen.getByTestId('status-segment-0-0')).toBeInTheDocument();
      expect(screen.getByTestId('status-segment-0-1')).toBeInTheDocument();
    });
  });

  describe('playhead', () => {
    const objects = [
      {
        label: 'Object 1',
        color: '#3b82f6',
        statusByTimestamp: { [t1]: 'confirmed', [t2]: 'pending', [t3]: 'empty' },
      } as const,
    ];

    it('marks exactly the matching segment, at full opacity with an inset highlight', () => {
      render(<ObjectStatusStrip objects={objects} playhead={{ objectIndex: 0, timestamp: t2 }} />);

      const hit = screen.getByTestId('status-segment-0-1');
      expect(hit).toHaveAttribute('data-playhead', 'true');
      // pending normally fades to opacity-40 — the playhead frame must not.
      expect(hit.className).not.toContain('opacity-40');
      expect(hit.style.boxShadow).toContain('inset');
      // fill keeps the object color under the highlight
      expect(hit.style.backgroundColor).toBe('rgb(59, 130, 246)');

      expect(screen.getByTestId('status-segment-0-0')).not.toHaveAttribute('data-playhead');
      expect(screen.getByTestId('status-segment-0-2')).not.toHaveAttribute('data-playhead');
    });

    it('renders exactly as before when no playhead is given', () => {
      render(<ObjectStatusStrip objects={objects} />);

      expect(screen.getByTestId('status-segment-0-1').className).toContain('opacity-40');
      expect(screen.getByTestId('status-segment-0-1')).not.toHaveAttribute('data-playhead');
    });
  });
});
