/**
 * Tests for PlatformAnnotationPill: the dot + text rendering of the
 * alert platform's own classification in the classify tables.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { PlatformAnnotationPill } from '@/components/sequences/PlatformAnnotationPill';

describe('PlatformAnnotationPill', () => {
  it('renders wildfire_smoke as Wildfire with a signal dot and provenance tooltip', () => {
    render(<PlatformAnnotationPill value="wildfire_smoke" />);

    const pill = screen.getByTitle(
      'Wildfire smoke — the alert platform classified this sequence as a wildfire'
    );
    expect(pill).toHaveTextContent('Wildfire');
    expect(pill.querySelector('.bg-signal')).not.toBeNull();
  });

  it('renders other_smoke as Other smoke with an ember dot and provenance tooltip', () => {
    render(<PlatformAnnotationPill value="other_smoke" />);

    const pill = screen.getByTitle(
      'Other smoke — the alert platform classified this as smoke, but not a wildfire'
    );
    expect(pill).toHaveTextContent('Other smoke');
    expect(pill.querySelector('.bg-ember')).not.toBeNull();
  });

  it('renders other as Other with a hollow dot and provenance tooltip', () => {
    render(<PlatformAnnotationPill value="other" />);

    const pill = screen.getByTitle(
      'Other — the alert platform classified this as neither wildfire nor smoke'
    );
    expect(pill).toHaveTextContent('Other');
    expect(pill.querySelector('.border-haze')).not.toBeNull();
    expect(pill.querySelector('.bg-signal')).toBeNull();
    expect(pill.querySelector('.bg-ember')).toBeNull();
  });

  it('renders nothing when the platform annotation is unset', () => {
    const { container } = render(<PlatformAnnotationPill value={null} />);

    expect(container).toBeEmptyDOMElement();
  });
});
