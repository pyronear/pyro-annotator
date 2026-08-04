import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { legacyRedirectRoutes } from '@/components/routing/legacyRedirects';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        {legacyRedirectRoutes}
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
    ['/detections/5/annotate/9?from=localize', '/localize/lane/5/9'],
    ['/detections/5/annotate?from=detections-review', '/localize/done/5'],
    ['/detections/5/annotate/9?from=detections-review', '/localize/done/5/9'],
  ])('redirects %s to %s', (oldUrl, newPath) => {
    renderAt(oldUrl);
    expect(screen.getByTestId('location')).toHaveTextContent(newPath);
  });
});
