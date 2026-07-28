/**
 * Detection frame cell for the sequence grid. Dense, chrome-free: the bordered
 * image itself is the whole cell. In the localize context the border encodes
 * the cell state (green = committed, amber = no box, transparent = pending
 * auto-accept) and the overlay shows exactly what quick submit would record.
 */

import { useState, useRef } from 'react';
import { Detection, DetectionAnnotation, SmokeType } from '@/types/api';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { CellState, getWinningBoxes } from '@/utils/annotation';
import {
  BoundingBoxOverlay,
  ReferenceBoxOverlay,
  SiblingBoundingBoxOverlay,
  UserAnnotationOverlay,
} from '@/components/annotation/ImageOverlays';

interface DetectionImageCardProps {
  detection: Detection;
  onClick: () => void;
  isAnnotated?: boolean;
  showPredictions?: boolean;
  showSiblingBboxes?: boolean;
  userAnnotation?: DetectionAnnotation | null;
  /** Localize grid: borders-only state encoding. Null/undefined = legacy mode. */
  cellState?: CellState | null;
  smokeType?: SmokeType;
}

interface ImageInfo {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function DetectionImageCard({
  detection,
  onClick,
  isAnnotated = false,
  showPredictions = false,
  showSiblingBboxes = true,
  userAnnotation = null,
  cellState = null,
  smokeType = 'wildfire',
}: DetectionImageCardProps) {
  const { data: imageData, isLoading } = useDetectionImage(detection.id);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      // Get actual rendered positions from DOM
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();
      setImageInfo({
        width: imgRect.width,
        height: imgRect.height,
        offsetX: imgRect.left - containerRect.left,
        offsetY: imgRect.top - containerRect.top,
      });
    }
  };

  const borderClass = cellState
    ? cellState === 'done'
      ? 'border-2 border-green-500'
      : cellState === 'no-box'
        ? 'border-2 border-amber-400'
        : 'border-2 border-transparent'
    : isAnnotated
      ? 'border-2 border-green-500'
      : 'border-2 border-orange-400';

  // Placeholders only carry a status border in the localize context, where
  // the state is known from the detection itself; legacy contexts stay
  // neutral while loading.
  const placeholderBorderClass = cellState ? borderClass : 'border-2 border-transparent';

  if (isLoading) {
    return <div className={`aspect-video bg-gray-200 animate-pulse ${placeholderBorderClass}`} />;
  }

  if (!imageData?.url) {
    return (
      <div
        className={`aspect-video bg-gray-100 flex items-center justify-center ${placeholderBorderClass}`}
      >
        <span className="text-gray-400 text-sm">No Image</span>
      </div>
    );
  }

  const winning = cellState === 'auto' ? getWinningBoxes(detection) : null;

  return (
    <div
      ref={containerRef}
      className={`aspect-video relative overflow-hidden bg-gray-100 cursor-pointer ${borderClass}`}
      onClick={onClick}
    >
      <img
        ref={imgRef}
        src={imageData.url}
        alt={`Frame ${detection.id}`}
        className="w-full h-full object-contain"
        onLoad={handleImageLoad}
        draggable={false}
      />

      {/* Model layer: legacy shows engine predictions; localize shows the
          winning layer (what quick submit would commit) on pending cells. */}
      {showPredictions && !cellState && detection.algo_predictions?.predictions && imageInfo && (
        <BoundingBoxOverlay detection={detection} imageInfo={imageInfo} />
      )}
      {showPredictions && winning && imageInfo && (
        <ReferenceBoxOverlay
          predictions={winning.boxes}
          variant={winning.layer}
          smokeType={smokeType}
          imageInfo={imageInfo}
          detectionId={detection.id}
        />
      )}

      {/* Sibling bboxes overlay (read-only hint for missed smoke) —
          gated on showPredictions so toggling predictions off hides
          everything algorithmic at once. */}
      {showPredictions && showSiblingBboxes && imageInfo && (
        <SiblingBoundingBoxOverlay detection={detection} imageInfo={imageInfo} />
      )}

      {/* User Annotations Overlay */}
      {(cellState === 'done' || !cellState) &&
        userAnnotation?.annotation?.annotation &&
        imageInfo && (
          <UserAnnotationOverlay detectionAnnotation={userAnnotation} imageInfo={imageInfo} />
        )}
    </div>
  );
}
