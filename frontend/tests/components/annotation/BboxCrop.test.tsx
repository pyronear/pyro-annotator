import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import React from 'react';
import { BboxCrop } from '@/components/annotation/BboxCrop';

describe('BboxCrop', () => {
  it('hides itself after a load error', () => {
    const { container } = render(
      <BboxCrop url="http://s3/broken.jpg" box={[0.1, 0.1, 0.4, 0.4]} />
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();
  });

  it('recovers when the url changes after an error', () => {
    // Presigned URLs expire; a refetch hands the same mounted component a
    // fresh url — the old failure must not keep the new image hidden.
    const { container, rerender } = render(
      <BboxCrop url="http://s3/expired.jpg" box={[0.1, 0.1, 0.4, 0.4]} />
    );
    fireEvent.error(container.querySelector('img')!);
    expect(container.querySelector('img')).toBeNull();

    rerender(<BboxCrop url="http://s3/fresh.jpg" box={[0.1, 0.1, 0.4, 0.4]} />);
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.getAttribute('src')).toBe('http://s3/fresh.jpg');
  });
});
