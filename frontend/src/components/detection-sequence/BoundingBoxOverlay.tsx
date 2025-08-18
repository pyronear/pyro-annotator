/**
 * Pure component for rendering AI prediction bounding boxes over detection images
 * 
 * This component displays model predictions as visual overlays with confidence scores.
 * It uses pure calculation functions and has no side effects.
 */

import { Detection, AlgoPrediction } from '@/types/api';
import { calculatePixelBounds } from '@/utils/bbox-calculations';
import { ImageInfo } from '@/utils/coordinate-transforms';

/**
 * Props for the BoundingBoxOverlay component
 */
export interface BoundingBoxOverlayProps {
  /** Detection containing AI predictions */
  readonly detection: Detection;
  /** Image dimension and positioning information */
  readonly imageInfo: ImageInfo;
  /** Optional CSS class name for styling */
  readonly className?: string;
  /** Whether to show confidence labels */
  readonly showConfidence?: boolean;
}

/**
 * Props for individual prediction box rendering
 */
interface PredictionBoxProps {
  readonly prediction: AlgoPrediction;
  readonly index: number;
  readonly detectionId: number;
  readonly imageInfo: ImageInfo;
  readonly showConfidence: boolean;
}

/**
 * Pure component for rendering a single prediction bounding box
 * 
 * @pure Component has no side effects and renders consistently for the same props
 */
const PredictionBox = ({ 
  prediction, 
  index, 
  detectionId, 
  imageInfo, 
  showConfidence 
}: PredictionBoxProps) => {
  // Convert normalized coordinates to pixel coordinates using pure function
  const normalizedBbox = {
    x1: prediction.xyxyn[0],
    y1: prediction.xyxyn[1],
    x2: prediction.xyxyn[2],
    y2: prediction.xyxyn[3]
  };
  
  const pixelBounds = calculatePixelBounds(normalizedBbox, imageInfo);
  
  // Validate bounds before rendering
  if (pixelBounds.width <= 0 || pixelBounds.height <= 0) {
    return null;
  }
  
  const confidencePercentage = Math.round(prediction.confidence * 100);
  
  return (
    <div
      key={`bbox-${detectionId}-${index}`}
      className="absolute border-2 border-red-500 bg-red-500/20 pointer-events-none"
      style={{
        left: `${pixelBounds.left}px`,
        top: `${pixelBounds.top}px`,
        width: `${pixelBounds.width}px`,
        height: `${pixelBounds.height}px`,
      }}
    >
      {showConfidence && (
        <div className="absolute -top-6 left-0 bg-red-500 text-white text-xs px-1 py-0.5 rounded whitespace-nowrap">
          {prediction.class_name} {confidencePercentage}%
        </div>
      )}
    </div>
  );
};

/**
 * Validates if a prediction has renderable coordinates
 * 
 * @pure Function has no side effects
 * @param prediction - AI prediction to validate
 * @returns true if prediction can be rendered
 */
const isRenderablePrediction = (prediction: AlgoPrediction): boolean => {
  const [x1, y1, x2, y2] = prediction.xyxyn;
  
  // Ensure coordinates are numbers and form a valid rectangle
  return (
    typeof x1 === 'number' && typeof y1 === 'number' &&
    typeof x2 === 'number' && typeof y2 === 'number' &&
    x2 > x1 && y2 > y1 &&
    !isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)
  );
};

/**
 * Component for rendering AI prediction bounding boxes over detection images
 * 
 * This component takes detection data and image positioning information,
 * then renders visual overlays for each valid prediction using pure calculations.
 * 
 * @example
 * <BoundingBoxOverlay
 *   detection={detection}
 *   imageInfo={{ width: 800, height: 600, offsetX: 10, offsetY: 5 }}
 *   showConfidence={true}
 * />
 */
const BoundingBoxOverlay = ({ 
  detection, 
  imageInfo, 
  className = '',
  showConfidence = true 
}: BoundingBoxOverlayProps) => {
  // Early return if no predictions available
  if (!detection?.algo_predictions?.predictions || detection.algo_predictions.predictions.length === 0) {
    return null;
  }
  
  // Filter predictions to only those that can be rendered
  const renderablePredictions = detection.algo_predictions.predictions.filter(isRenderablePrediction);
  
  if (renderablePredictions.length === 0) {
    return null;
  }
  
  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {renderablePredictions.map((prediction, index) => (
        <PredictionBox
          key={`prediction-${detection.id}-${index}`}
          prediction={prediction}
          index={index}
          detectionId={detection.id}
          imageInfo={imageInfo}
          showConfidence={showConfidence}
        />
      ))}
    </div>
  );
};

export default BoundingBoxOverlay;