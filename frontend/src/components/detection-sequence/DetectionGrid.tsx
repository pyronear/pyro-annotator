import { Detection, DetectionAnnotation } from '@/types/api';
import { DetectionImageCard } from '@/components/detection-annotation';

interface DetectionGridProps {
  detections: Detection[];
  onDetectionClick: (index: number) => void;
  showPredictions: boolean;
  detectionAnnotations: Map<number, DetectionAnnotation>;
  /** 'done' when the page was entered from the Localize Done list. */
  mode?: 'done';
  getIsAnnotated: (annotation: DetectionAnnotation | undefined, mode?: 'done') => boolean;
}

export function DetectionGrid({
  detections,
  onDetectionClick,
  showPredictions,
  detectionAnnotations,
  mode,
  getIsAnnotated,
}: DetectionGridProps) {
  return (
    <div className="space-y-6 pt-20">
      {/* Detection Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
        {detections.map((detection, index) => (
          <DetectionImageCard
            key={detection.id}
            detection={detection}
            onClick={() => onDetectionClick(index)}
            isAnnotated={getIsAnnotated(detectionAnnotations.get(detection.id), mode)}
            showPredictions={showPredictions}
            userAnnotation={detectionAnnotations.get(detection.id) || null}
          />
        ))}
      </div>
    </div>
  );
}
