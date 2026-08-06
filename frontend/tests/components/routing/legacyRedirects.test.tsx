import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { legacyRedirectRoutes } from '@/components/routing/legacyRedirects';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        {legacyRedirectRoutes}
        {/* The alert page's own routes, as App.tsx mounts them. They are what
            the redirects land on, and the literal "done" one outranks the
            redirect table's dynamic /localize/:sequenceId/:detectionId entry
            (static segments win) — without it this partial table would let
            that entry swallow /localize/done/5. */}
        <Route path="/localize/done/:sequenceId" element={<LocationProbe />} />
        <Route path="/localize/:sequenceId" element={<LocationProbe />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );

describe('legacy route redirects', () => {
  it.each([
    ['/sequences/annotate', '/classify'],
    ['/sequences/review', '/classify/done'],
    ['/sequences/42/annotate', '/classify/42'],
    ['/sequences/42/annotate?from=review', '/classify/done/42'],
    ['/sequence-groups', '/classify/groups'],
    ['/sequence-groups/7/annotate', '/classify/groups/7'],
    ['/detections/annotate', '/localize'],
    ['/detections/review', '/localize/done'],
    ['/detections/5/annotate', '/localize/5'],
    ['/detections/5/annotate?from=localize', '/localize/5'],
    ['/detections/5/annotate?from=detections-review', '/localize/done/5'],
    // A frame in an old link becomes a ?frame= deep link, not an open editor:
    // the editor URL names its object now, and the object can't be resolved
    // without loading the alert and every lane's detections.
    ['/detections/5/annotate/9?from=localize', '/localize/5?frame=9'],
    ['/detections/5/annotate/9?from=detections-review', '/localize/done/5?frame=9'],
    // Same for the pre-object-route editor shape itself, under either
    // provenance — the Done route produced it too.
    ['/localize/5/9', '/localize/5?frame=9'],
    ['/localize/done/5/9', '/localize/done/5?frame=9'],
  ])('redirects %s to %s', (oldUrl, newPath) => {
    renderAt(oldUrl);
    expect(screen.getByTestId('location')).toHaveTextContent(newPath);
  });
});
