import { Detection, DetectionAnnotation, SmokeType } from '@/types/api';
import { CellState } from '@/utils/annotation';
import { DetectionImageCard } from '@/components/detection-annotation';

interface DetectionGridProps {
  detections: Detection[];
  onDetectionClick: (index: number) => void;
  showPredictions: boolean;
  detectionAnnotations: Map<number, DetectionAnnotation>;
  /** 'done' when the page was entered from the Localize Done list. */
  mode?: 'done';
  getIsAnnotated: (annotation: DetectionAnnotation | undefined, mode?: 'done') => boolean;
  /** Localize queue: per-frame cell state for borders-only encoding. */
  getCellState?: (detection: Detection) => CellState;
  smokeType?: SmokeType;
  /** Localize queue: zoom cells around their displayed boxes. */
  cropMode?: boolean;
  /** Minimum card width driving the auto-fill column count. */
  cardMinWidth?: number;
}

export function DetectionGrid({
  detections,
  onDetectionClick,
  showPredictions,
  detectionAnnotations,
  mode,
  getIsAnnotated,
  getCellState,
  smokeType,
  cropMode = false,
  cardMinWidth = 340,
}: DetectionGridProps) {
  return (
    <div
      className="grid gap-px"
      style={{
        gridTemplateColumns: `repeat(auto-fill, minmax(min(${cardMinWidth}px, 100%), 1fr))`,
      }}
    >
      {detections.map((detection, index) => (
        <DetectionImageCard
          key={detection.id}
          detection={detection}
          onClick={() => onDetectionClick(index)}
          isAnnotated={getIsAnnotated(detectionAnnotations.get(detection.id), mode)}
          showPredictions={showPredictions}
          userAnnotation={detectionAnnotations.get(detection.id) || null}
          cellState={getCellState ? getCellState(detection) : null}
          smokeType={smokeType}
          cropMode={cropMode}
        />
      ))}
    </div>
  );
}
