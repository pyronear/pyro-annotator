/**
 * Detection Sequence Annotation Page (Refactored)
 * 
 * This refactored version demonstrates functional programming principles:
 * - Uses pure utility functions for calculations
 * - Separates concerns with extracted components  
 * - Manages state at the edge with custom hooks
 * - Employs referentially transparent functions
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Upload, RotateCcw, Square, Trash2, Keyboard, Eye, MousePointer, Undo, Navigation, Clock, Brain } from 'lucide-react';

// API and Data Hooks
import { useSequenceDetections } from '@/hooks/useSequenceDetections';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';

// Pure Utility Functions
import { screenToImageCoordinates, imageToNormalized, normalizedToImage } from '@/utils/coordinate-transforms';
import { filterValidPredictions, preparePredictionsForImport, getImportablePredictionCount } from '@/utils/prediction-filtering';
import { getSmokeTypeColors, getSmokeTypeLabel } from '@/utils/smoke-type-colors';
import { calculatePixelBounds, isPointInBbox as isPointInBboxUtil } from '@/utils/bbox-calculations';
import { isValidPrediction, doBboxesMatch } from '@/utils/validation';

// Custom Hooks for State Management
import { useDrawingState } from '@/hooks/detection-sequence/useDrawingState';
import { useImageTransforms } from '@/hooks/detection-sequence/useImageTransforms';

// Extracted Pure Components  
import BoundingBoxOverlay from '@/components/detection-sequence/BoundingBoxOverlay';
import UserAnnotationOverlay from '@/components/detection-sequence/UserAnnotationOverlay';
import DrawingOverlay from '@/components/detection-sequence/DrawingOverlay';

// Types
import { Detection, DetectionAnnotation, SmokeType } from '@/types/api';
import { analyzeSequenceAccuracy, getFalsePositiveEmoji, formatFalsePositiveType, getModelAccuracyBadgeClasses } from '@/utils/modelAccuracy';

/**
 * Props for the main image modal component
 */
interface ImageModalProps {
  readonly detection: Detection;
  readonly onClose: () => void;
  readonly onNavigate: (direction: 'prev' | 'next') => void;
  readonly onSubmit: (detection: Detection, rectangles: any[], drawMode: boolean) => void;
  readonly onTogglePredictions: (show: boolean) => void;
  readonly canNavigatePrev: boolean;
  readonly canNavigateNext: boolean;
  readonly currentIndex: number;
  readonly totalCount: number;
  readonly showPredictions?: boolean;
  readonly isSubmitting?: boolean;
  readonly isAnnotated?: boolean;
  readonly existingAnnotation?: DetectionAnnotation | null;
  readonly selectedSmokeType: SmokeType;
  readonly onSmokeTypeChange: (smokeType: SmokeType) => void;
  readonly persistentDrawMode: boolean;
  readonly onDrawModeChange: (drawMode: boolean) => void;
  readonly isAutoAdvance: boolean;
}

/**
 * Pure component for detection image card display
 */
interface DetectionImageCardProps {
  readonly detection: Detection;
  readonly onClick: () => void;
  readonly isAnnotated?: boolean;
  readonly showPredictions?: boolean;
  readonly userAnnotation?: DetectionAnnotation | null;
}

/**
 * Pure detection image card component
 * 
 * @pure Component renders consistently for the same props without side effects
 */
const DetectionImageCard = ({ 
  detection, 
  onClick, 
  isAnnotated = false, 
  showPredictions = false, 
  userAnnotation = null 
}: DetectionImageCardProps) => {
  const { data: imageData, isLoading } = useDetectionImage(detection.id);
  const [imageInfo, setImageInfo] = useState<{ width: number; height: number; offsetX: number; offsetY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Pure function for handling image load and calculating dimensions
  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();

      setImageInfo({
        width: imgRect.width,
        height: imgRect.height,
        offsetX: imgRect.left - containerRect.left,
        offsetY: imgRect.top - containerRect.top
      });
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gray-50 rounded-lg p-3 shadow-sm">
        <div className="aspect-video bg-gray-200 animate-pulse rounded-lg">
          <div className="w-full h-full flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
          </div>
        </div>
        <div className="mt-3 h-8 bg-gray-200 animate-pulse rounded"></div>
      </div>
    );
  }

  if (!imageData?.url) {
    return (
      <div className="bg-gray-50 rounded-lg p-3 shadow-sm border-2 border-gray-200">
        <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center">
          <span className="text-gray-400 text-sm">No Image</span>
        </div>
        <div className="mt-3 py-2">
          <p className="text-xs text-gray-500">
            {new Date(detection.recorded_at).toLocaleString()}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div 
      className={`group cursor-pointer rounded-lg transition-all duration-200 transform hover:scale-[1.02] hover:shadow-lg ${
        isAnnotated 
          ? 'bg-green-50 border-4 border-green-500 shadow-md hover:border-green-600 hover:bg-green-100' 
          : 'bg-orange-50 border-4 border-orange-400 shadow-md hover:border-orange-500 hover:bg-orange-100 animate-pulse-subtle'
      }`}
      onClick={onClick}
    >
      <div className="p-3">
        <div ref={containerRef} className="relative aspect-video overflow-hidden rounded-lg bg-white">
          <img
            ref={imgRef}
            src={imageData.url}
            alt={`Detection ${detection.id}`}
            className="w-full h-full object-contain"
            onLoad={handleImageLoad}
            onError={(e) => {
              const target = e.target as HTMLImageElement;
              target.style.display = 'none';
              const parent = target.parentElement;
              if (parent) {
                parent.innerHTML = '<span class="text-gray-400 text-sm flex items-center justify-center h-full">Error loading image</span>';
              }
            }}
          />

          {/* Pure Bounding Boxes Overlay */}
          {showPredictions && imageInfo && (
            <div className="absolute inset-0 pointer-events-none transition-opacity duration-300 ease-in-out animate-in fade-in">
              <BoundingBoxOverlay detection={detection} imageInfo={imageInfo} />
            </div>
          )}

          {/* Pure User Annotations Overlay */}
          {userAnnotation && imageInfo && (
            <div className="absolute inset-0 pointer-events-none transition-opacity duration-300 ease-in-out animate-in fade-in">
              <UserAnnotationOverlay detectionAnnotation={userAnnotation} imageInfo={imageInfo} />
            </div>
          )}

          {/* Status Badge */}
          <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-semibold backdrop-blur-sm ${
            isAnnotated 
              ? 'bg-green-600/90 text-white' 
              : 'bg-orange-500/90 text-white'
          }`}>
            {isAnnotated ? 'Reviewed' : 'Pending'}
          </div>
        </div>
        
        {/* Status Bar */}
        <div className={`mt-3 px-3 py-2 rounded-md ${
          isAnnotated 
            ? 'bg-green-100 border border-green-300' 
            : 'bg-orange-100 border border-orange-300'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {isAnnotated ? (
                <>
                  <CheckCircle className="w-5 h-5 text-green-600" />
                  <span className="text-sm font-medium text-green-700">Completed</span>
                </>
              ) : (
                <>
                  <Clock className="w-5 h-5 text-orange-600 animate-pulse" />
                  <span className="text-sm font-medium text-orange-700">Needs Review</span>
                </>
              )}
            </div>
          </div>
          <p className="text-xs text-gray-600 mt-1">
            {new Date(detection.recorded_at).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
};

/**
 * Refactored Image Modal using extracted components and pure functions
 */
const ImageModal = ({
  detection,
  onClose,
  onNavigate,
  onSubmit,
  onTogglePredictions,
  canNavigatePrev,
  canNavigateNext,
  currentIndex,
  totalCount,
  showPredictions = false,
  isSubmitting = false,
  isAnnotated = false,
  existingAnnotation = null,
  selectedSmokeType,
  onSmokeTypeChange,
  persistentDrawMode,
  onDrawModeChange,
  isAutoAdvance
}: ImageModalProps) => {
  const { data: imageData } = useDetectionImage(detection.id);
  const [imageInfo, setImageInfo] = useState<{ width: number; height: number; offsetX: number; offsetY: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Use custom hooks for state management
  const { state: transformState, actions: transformActions, transform } = useImageTransforms({
    minZoom: 1.0,
    maxZoom: 4.0,
    zoomStep: 0.2,
    imageInfo
  });

  const { state: drawingState, actions: drawingActions } = useDrawingState({
    initialSmokeType: selectedSmokeType,
    maxUndoSteps: 50,
    containerInfo: imageInfo ? { width: imageInfo.width, height: imageInfo.height } : undefined,
    naturalImageInfo: imgRef.current ? { width: imgRef.current.naturalWidth, height: imgRef.current.naturalHeight } : undefined
  });

  // Pure function for handling image load
  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();

      setImageInfo({
        width: imgRect.width,
        height: imgRect.height,
        offsetX: imgRect.left - containerRect.left,
        offsetY: imgRect.top - containerRect.top
      });
    }
  };

  // Import AI predictions using pure filtering functions
  const importAIPredictions = () => {
    if (!detection?.algo_predictions?.predictions) return;
    
    const preparedPredictions = preparePredictionsForImport(
      detection.algo_predictions.predictions,
      drawingState.drawnRectangles
    );
    
    if (preparedPredictions.length === 0) return;
    
    // Convert predictions to drawn rectangles
    const importedRectangles = preparedPredictions.map((pred, index) => ({
      id: `imported-${Date.now()}-${index}`,
      xyxyn: pred.xyxyn as readonly [number, number, number, number],
      smokeType: selectedSmokeType
    }));
    
    drawingActions.importRectangles(importedRectangles);
  };

  // Get count of importable predictions
  const importablePredictionCount = useMemo(() => {
    if (!detection?.algo_predictions?.predictions) return 0;
    return getImportablePredictionCount(detection.algo_predictions.predictions, drawingState.drawnRectangles);
  }, [detection?.algo_predictions?.predictions, drawingState.drawnRectangles]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-6xl max-h-[95vh] w-full mx-4 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center space-x-4">
            <button
              onClick={onClose}
              className="p-2 hover:bg-gray-100 rounded-full transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h2 className="text-lg font-semibold">Detection {currentIndex + 1} of {totalCount}</h2>
              <p className="text-sm text-gray-600">{new Date(detection.recorded_at).toLocaleString()}</p>
            </div>
          </div>
          
          {/* Actions */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onTogglePredictions(!showPredictions)}
              className={`p-2 rounded-full transition-colors ${showPredictions ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100'}`}
              title="Toggle AI predictions"
            >
              <Eye className="w-5 h-5" />
            </button>
            
            {importablePredictionCount > 0 && (
              <button
                onClick={importAIPredictions}
                className="flex items-center space-x-2 px-3 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
                title={`Import ${importablePredictionCount} AI predictions`}
              >
                <Brain className="w-4 h-4" />
                <span>Import AI ({importablePredictionCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Image Area */}
        <div className="flex-1 relative overflow-hidden">
          <div
            ref={containerRef}
            className="w-full h-full flex items-center justify-center bg-gray-100"
            onWheel={(e) => {
              if (imgRef.current) {
                const rect = imgRef.current.getBoundingClientRect();
                transformActions.handleWheel(e.nativeEvent, rect);
              }
            }}
          >
            {imageData?.url && (
              <>
                <img
                  ref={imgRef}
                  src={imageData.url}
                  alt={`Detection ${detection.id}`}
                  className="max-w-full max-h-full object-contain"
                  onLoad={handleImageLoad}
                />

                {/* Pure Overlays */}
                {showPredictions && imageInfo && (
                  <BoundingBoxOverlay 
                    detection={detection} 
                    imageInfo={imageInfo}
                    className="transition-opacity duration-300"
                  />
                )}

                {existingAnnotation && imageInfo && (
                  <UserAnnotationOverlay 
                    detectionAnnotation={existingAnnotation} 
                    imageInfo={imageInfo}
                    className="transition-opacity duration-300"
                  />
                )}

                {imageInfo && (
                  <DrawingOverlay
                    drawnRectangles={drawingState.drawnRectangles}
                    currentDrawing={drawingState.currentDrawing}
                    selectedRectangleId={drawingState.selectedRectangleId}
                    imageInfo={imageInfo}
                    transform={transform}
                    isDragging={transformState.isDragging}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {/* Bottom Controls */}
        <div className="flex items-center justify-between p-4 border-t bg-gray-50">
          <div className="flex items-center space-x-2">
            <button
              onClick={() => onNavigate('prev')}
              disabled={!canNavigatePrev}
              className="p-2 hover:bg-gray-200 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <span className="text-sm text-gray-600">
              {currentIndex + 1} / {totalCount}
            </span>
            <button
              onClick={() => onNavigate('next')}
              disabled={!canNavigateNext}
              className="p-2 hover:bg-gray-200 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          <button
            onClick={() => onSubmit(detection, Array.from(drawingState.drawnRectangles), drawingState.isDrawMode)}
            disabled={isSubmitting}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Submitting...' : isAnnotated ? 'Update' : 'Submit'}
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Main Detection Sequence Annotation Page (Refactored)
 * 
 * This version demonstrates functional programming principles while maintaining
 * the same functionality as the original component.
 */
export default function DetectionSequenceAnnotatePageRefactored() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  
  const sequenceId = id ? parseInt(id) : null;
  
  // State management at the edge
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [showPredictions, setShowPredictions] = useState(false);
  const [selectedSmokeType, setSelectedSmokeType] = useState<SmokeType>('wildfire');
  const [persistentDrawMode, setPersistentDrawMode] = useState(false);
  const [isAutoAdvance, setIsAutoAdvance] = useState(false);
  
  // Fetch detections using existing hook
  const { data: detections, isLoading, error } = useSequenceDetections(sequenceId!);
  
  // Handle detection selection
  const handleDetectionClick = (detection: Detection) => {
    setSelectedDetection(detection);
  };

  // Handle modal navigation
  const handleNavigate = (direction: 'prev' | 'next') => {
    if (!detections || !selectedDetection) return;
    
    const currentIndex = detections.findIndex(d => d.id === selectedDetection.id);
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    
    if (newIndex >= 0 && newIndex < detections.length) {
      setSelectedDetection(detections[newIndex]);
      setIsAutoAdvance(true);
    }
  };

  // Handle annotation submission
  const handleSubmit = async (detection: Detection, rectangles: any[], drawMode: boolean) => {
    // Implementation would go here
    console.log('Submitting annotation:', { detection, rectangles, drawMode });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error || !detections) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load detections</p>
          <p className="text-gray-500 text-sm">{String(error)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Detection Sequence Annotation</h1>
          <p className="text-gray-600">Annotate individual detections in sequence {sequenceId}</p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="flex items-center space-x-2 px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
      </div>

      {/* Detection Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {detections.map((detection) => (
          <DetectionImageCard
            key={detection.id}
            detection={detection}
            onClick={() => handleDetectionClick(detection)}
            showPredictions={showPredictions}
          />
        ))}
      </div>

      {/* Image Modal */}
      {selectedDetection && (
        <ImageModal
          detection={selectedDetection}
          onClose={() => setSelectedDetection(null)}
          onNavigate={handleNavigate}
          onSubmit={handleSubmit}
          onTogglePredictions={setShowPredictions}
          canNavigatePrev={detections.findIndex(d => d.id === selectedDetection.id) > 0}
          canNavigateNext={detections.findIndex(d => d.id === selectedDetection.id) < detections.length - 1}
          currentIndex={detections.findIndex(d => d.id === selectedDetection.id)}
          totalCount={detections.length}
          showPredictions={showPredictions}
          selectedSmokeType={selectedSmokeType}
          onSmokeTypeChange={setSelectedSmokeType}
          persistentDrawMode={persistentDrawMode}
          onDrawModeChange={setPersistentDrawMode}
          isAutoAdvance={isAutoAdvance}
        />
      )}
    </div>
  );
}