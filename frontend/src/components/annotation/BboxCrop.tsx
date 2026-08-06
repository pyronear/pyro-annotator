import { useState } from 'react';

export type Bbox = [number, number, number, number];

// Zoomed view of a single image centered on `box`. The same (already cached)
// detection image is reused and magnified with a CSS transform — no second
// fetch, no canvas — so small objects are legible next to the full frame.
export function BboxCrop({ url, box, loading }: { url: string; box: Bbox; loading?: 'lazy' }) {
  const [failed, setFailed] = useState(false);
  const [x1, y1, x2, y2] = box;
  const cx = (x1 + x2) / 2;
  const cy = (y1 + y2) / 2;
  // Show the box plus a margin of one box-size on each side (region ≈ 3×),
  // then zoom so the whole region fits the cell; cap at 8× for tiny boxes.
  const regionW = Math.min(1, Math.max(x2 - x1, 0.001) * 3);
  const regionH = Math.min(1, Math.max(y2 - y1, 0.001) * 3);
  const zoom = Math.min(1 / regionW, 1 / regionH, 8);

  if (failed) return null;
  return (
    <img
      src={url}
      alt=""
      loading={loading}
      onError={() => setFailed(true)}
      className="absolute inset-0 w-full h-full object-cover"
      style={{
        transformOrigin: `${cx * 100}% ${cy * 100}%`,
        transform: `translate(${(0.5 - cx) * 100}%, ${(0.5 - cy) * 100}%) scale(${zoom})`,
      }}
    />
  );
}
