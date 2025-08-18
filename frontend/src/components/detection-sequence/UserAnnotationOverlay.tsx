/**
 * Pure component for rendering user-drawn annotation overlays
 * 
 * This component displays human annotations as visual overlays with smoke type styling.
 * It uses pure calculation and styling functions.
 */

import { DetectionAnnotation } from '@/types/api';
import { calculatePixelBounds } from '@/utils/bbox-calculations';
import { getSmokeTypeColors, getSmokeTypeLabel } from '@/utils/smoke-type-colors';
import { ImageInfo } from '@/utils/coordinate-transforms';

/**
 * Props for the UserAnnotationOverlay component
 */
export interface UserAnnotationOverlayProps {
  /** Detection annotation containing user annotations */
  readonly detectionAnnotation: DetectionAnnotation | null;
  /** Image dimension and positioning information */
  readonly imageInfo: ImageInfo;
  /** Optional CSS class name for styling */
  readonly className?: string;
  /** Whether to show smoke type labels */
  readonly showLabels?: boolean;
}

/**
 * Props for individual annotation box rendering
 */
interface AnnotationBoxProps {
  readonly annotation: any; // AnnotationBbox from the API
  readonly index: number;
  readonly detectionId: number;
  readonly imageInfo: ImageInfo;
  readonly showLabels: boolean;
}

/**
 * Pure component for rendering a single user annotation bounding box
 * 
 * @pure Component has no side effects and renders consistently for the same props
 */
const AnnotationBox = ({ 
  annotation, 
  index, 
  detectionId, 
  imageInfo, 
  showLabels 
}: AnnotationBoxProps) => {
  // Convert normalized coordinates to pixel coordinates using pure function
  const normalizedBbox = {
    x1: annotation.xyxyn[0],
    y1: annotation.xyxyn[1], 
    x2: annotation.xyxyn[2],
    y2: annotation.xyxyn[3]
  };
  
  const pixelBounds = calculatePixelBounds(normalizedBbox, imageInfo);
  
  // Validate bounds before rendering
  if (pixelBounds.width <= 0 || pixelBounds.height <= 0) {
    return null;
  }
  
  // Get colors for this smoke type using pure function
  const colors = getSmokeTypeColors(annotation.smoke_type);
  const label = getSmokeTypeLabel(annotation.smoke_type);
  
  return (
    <div
      key={`user-annotation-${detectionId}-${index}`}
      className={`absolute border-2 ${colors.border} ${colors.background} pointer-events-none`}
      style={{
        left: `${pixelBounds.left}px`,
        top: `${pixelBounds.top}px`,
        width: `${pixelBounds.width}px`,
        height: `${pixelBounds.height}px`,
      }}
    >
      {showLabels && (
        <div className={`absolute -top-6 left-0 ${colors.border.replace('border-', 'bg-')} text-white text-xs px-1 py-0.5 rounded whitespace-nowrap`}>
          {label}
        </div>
      )}
    </div>
  );
};

/**
 * Validates if an annotation has renderable coordinates and smoke type
 * 
 * @pure Function has no side effects
 * @param annotation - User annotation to validate
 * @returns true if annotation can be rendered
 */
const isRenderableAnnotation = (annotation: any): boolean => {
  // Check if xyxyn array exists and has correct structure
  if (!annotation.xyxyn || !Array.isArray(annotation.xyxyn) || annotation.xyxyn.length !== 4) {
    return false;
  }
  
  const [x1, y1, x2, y2] = annotation.xyxyn;
  
  // Ensure coordinates are numbers and form a valid rectangle
  const hasValidCoords = (
    typeof x1 === 'number' && typeof y1 === 'number' &&
    typeof x2 === 'number' && typeof y2 === 'number' &&
    x2 > x1 && y2 > y1 &&
    !isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2)
  );
  
  // Check if smoke type is provided
  const hasValidSmokeType = annotation.smoke_type && typeof annotation.smoke_type === 'string';
  
  return hasValidCoords && hasValidSmokeType;
};

/**
 * Component for rendering user annotation overlays on detection images
 * 
 * This component takes detection annotation data and image positioning information,
 * then renders visual overlays for each valid user annotation with appropriate
 * smoke type styling using pure calculation and styling functions.
 * 
 * @example
 * <UserAnnotationOverlay
 *   detectionAnnotation={userAnnotation}
 *   imageInfo={{ width: 800, height: 600, offsetX: 10, offsetY: 5 }}
 *   showLabels={true}
 * />
 */
const UserAnnotationOverlay = ({ 
  detectionAnnotation, 
  imageInfo, 
  className = '',
  showLabels = true 
}: UserAnnotationOverlayProps) => {
  // Early return if no annotation data available
  if (!detectionAnnotation?.annotation?.annotation || detectionAnnotation.annotation.annotation.length === 0) {
    return null;
  }
  
  // Filter annotations to only those that can be rendered
  const renderableAnnotations = detectionAnnotation.annotation.annotation.filter(isRenderableAnnotation);
  
  if (renderableAnnotations.length === 0) {
    return null;
  }
  
  return (
    <div className={`absolute inset-0 pointer-events-none ${className}`}>
      {renderableAnnotations.map((annotation, index) => (
        <AnnotationBox
          key={`annotation-${detectionAnnotation.detection_id}-${index}`}
          annotation={annotation}
          index={index}
          detectionId={detectionAnnotation.detection_id}
          imageInfo={imageInfo}
          showLabels={showLabels}
        />
      ))}
    </div>
  );
};

export default UserAnnotationOverlay;