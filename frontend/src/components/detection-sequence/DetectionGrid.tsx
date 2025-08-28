import { Detection, DetectionAnnotation } from '@/types/api';
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
}

export function DetectionGrid({
  detections,
  onDetectionClick,
  showPredictions,
  detectionAnnotations,
  fromParam,
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
            isAnnotated={getIsAnnotated(detectionAnnotations.get(detection.id), fromParam)}
            showPredictions={showPredictions}
            userAnnotation={detectionAnnotations.get(detection.id) || null}
          />
        ))}
      </div>
    </div>
  );
}