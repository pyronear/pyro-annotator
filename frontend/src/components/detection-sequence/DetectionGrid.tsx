import { Detection, DetectionAnnotation, SmokeType } from '@/types/api';
import { CellState } from '@/utils/annotation';
import { DetectionImageCard } from '@/components/detection-annotation';

interface DetectionGridProps {
  detections: Detection[];
  onDetectionClick: (index: number) => void;
  showPredictions: boolean;
  detectionAnnotations: Map<number, DetectionAnnotation>;
  fromParam: string | null;
  getIsAnnotated: (
    annotation: DetectionAnnotation | undefined,
    fromContext: string | null
  ) => boolean;
  /** Localize context: per-frame cell state for borders-only encoding. */
  getCellState?: (detection: Detection) => CellState;
  smokeType?: SmokeType;
}

export function DetectionGrid({
  detections,
  onDetectionClick,
  showPredictions,
  detectionAnnotations,
  fromParam,
  getIsAnnotated,
  getCellState,
  smokeType,
}: DetectionGridProps) {
  return (
    <div className="pt-20">
      {/* Detection Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-px">
        {detections.map((detection, index) => (
          <DetectionImageCard
            key={detection.id}
            detection={detection}
            onClick={() => onDetectionClick(index)}
            isAnnotated={getIsAnnotated(detectionAnnotations.get(detection.id), fromParam)}
            showPredictions={showPredictions}
            userAnnotation={detectionAnnotations.get(detection.id) || null}
            cellState={getCellState ? getCellState(detection) : null}
            smokeType={smokeType}
          />
        ))}
      </div>
    </div>
  );
}
