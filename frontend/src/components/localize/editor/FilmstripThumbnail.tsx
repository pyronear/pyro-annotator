/**
 * One filmstrip cell's image, cropped to the object's box so the strip reads
 * as a sequence of the OBJECT rather than a sequence of wide landscapes. An
 * entry with no box (out of range, or in range with nothing on offer) renders
 * the frame uncropped — there is no region to zoom to.
 */

import { useEffect, useRef } from 'react';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { computeSquareCrop } from '@/utils/annotation/squareCropUtils';

const RES = 96;

export function FilmstripThumbnail({
  detectionId,
  xyxyn,
}: {
  detectionId: number;
  xyxyn: [number, number, number, number] | null;
}) {
  // `useDetectionImage` is a useQuery wrapper over `getDetectionImageUrl`,
  // which resolves to `{ url }` — not a bare string.
  const { data: imageData } = useDetectionImage(detectionId > 0 ? detectionId : null);
  const imageUrl = imageData?.url ?? null;
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imageUrl) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, RES, RES);
      if (!xyxyn) {
        ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, RES, RES);
        return;
      }
      const crop = computeSquareCrop(xyxyn, img.width, img.height, 1);
      ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, RES, RES);
    };
    img.src = imageUrl;
  }, [imageUrl, xyxyn]);

  return <canvas ref={canvasRef} width={RES} height={RES} className="h-full w-full bg-white/5" />;
}
