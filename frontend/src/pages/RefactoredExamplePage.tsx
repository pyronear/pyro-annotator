/**
 * Example page demonstrating the refactored functional programming approach
 * 
 * This page shows how to:
 * - Use pure utility functions for calculations
 * - Compose functionality with HOCs
 * - Manage state at the edge using custom hooks
 * - Build components with pure functions and referential transparency
 */

import React, { useEffect, useState } from 'react';
import { Detection, SmokeType } from '@/types/api';

// Pure utility functions
import { filterValidPredictions, getImportablePredictionCount } from '@/utils/prediction-filtering';
import { getSmokeTypeColors, getSmokeTypeLabel } from '@/utils/smoke-type-colors';
import { calculatePixelBounds } from '@/utils/bbox-calculations';
import { isValidPrediction } from '@/utils/validation';

// Extracted components
import BoundingBoxOverlay from '@/components/detection-sequence/BoundingBoxOverlay';
import UserAnnotationOverlay from '@/components/detection-sequence/UserAnnotationOverlay';
import DrawingOverlay from '@/components/detection-sequence/DrawingOverlay';

// Custom hooks for state management
import { useDrawingState } from '@/hooks/detection-sequence/useDrawingState';
import { useImageTransforms } from '@/hooks/detection-sequence/useImageTransforms';

// HOCs for cross-cutting concerns
import { withImageInfo, WithImageInfoProps } from '@/components/hoc/withImageInfo';
import { withLoadingState, WithLoadingStateProps } from '@/components/hoc/withLoadingState';
import { withKeyboardShortcuts, WithKeyboardShortcutsProps } from '@/components/hoc/withKeyboardShortcuts';

// Refactored state management
import { useSequenceStoreRefactored, selectors } from '@/store/useSequenceStoreRefactored';

/**
 * Props for the main example component
 */
interface ExampleComponentProps extends 
  WithImageInfoProps,
  WithLoadingStateProps,
  WithKeyboardShortcutsProps {
  readonly detection?: Detection;
  readonly onSave?: (data: any) => void;
}

/**
 * Pure component demonstrating functional composition
 * 
 * This component uses:
 * - Pure utility functions for all calculations
 * - Custom hooks for state management at the edge
 * - HOC-provided functionality for cross-cutting concerns
 * - Extracted pure components for rendering
 */
const ExampleComponent = ({
  detection,
  onSave,
  imageInfo,
  containerRef,
  imageRef,
  updateImageInfo,
  coordinateTransforms,
  addShortcut,
  shortcuts,
  shortcutsEnabled
}: ExampleComponentProps) => {
  // State management at the edge using custom hooks
  const { state: drawingState, actions: drawingActions } = useDrawingState({
    initialSmokeType: 'wildfire',
    maxUndoSteps: 50,
    containerInfo: imageInfo ? { width: imageInfo.width, height: imageInfo.height } : undefined,
    naturalImageInfo: imageRef.current ? { 
      width: imageRef.current.naturalWidth, 
      height: imageRef.current.naturalHeight 
    } : undefined
  });

  const { state: transformState, actions: transformActions, transform } = useImageTransforms({
    minZoom: 1.0,
    maxZoom: 4.0,
    zoomStep: 0.2,
    imageInfo
  });

  // Local state for UI controls
  const [selectedSmokeType, setSelectedSmokeType] = useState<SmokeType>('wildfire');
  const [showPredictions, setShowPredictions] = useState(true);

  // Set up keyboard shortcuts using HOC functionality
  useEffect(() => {
    addShortcut({
      key: 'd',
      handler: () => {
        drawingActions.setDrawMode(!drawingState.isDrawMode);
        return true;
      },
      description: 'Toggle draw mode'
    });

    addShortcut({
      key: 'p',
      handler: () => {
        setShowPredictions(prev => !prev);
        return true;
      },
      description: 'Toggle predictions'
    });

    addShortcut({
      key: 'z',
      ctrlKey: true,
      handler: () => {
        if (drawingActions.canUndo) {
          drawingActions.undo();
        }
        return true;
      },
      description: 'Undo last action'
    });

    addShortcut({
      key: 'r',
      handler: () => {
        transformActions.resetTransform();
        return true;
      },
      description: 'Reset zoom/pan'
    });

    addShortcut({
      key: '1',
      handler: () => {
        setSelectedSmokeType('wildfire');
        return true;
      },
      description: 'Select wildfire smoke type'
    });

    addShortcut({
      key: '2',
      handler: () => {
        setSelectedSmokeType('industrial');
        return true;
      },
      description: 'Select industrial smoke type'
    });

    addShortcut({
      key: '3',
      handler: () => {
        setSelectedSmokeType('other');
        return true;
      },
      description: 'Select other smoke type'
    });
  }, [addShortcut, drawingState.isDrawMode, drawingActions, transformActions]);

  // Pure function to calculate importable predictions count
  const importablePredictionCount = React.useMemo(() => {
    if (!detection?.algo_predictions?.predictions) return 0;
    return getImportablePredictionCount(
      detection.algo_predictions.predictions,
      drawingState.drawnRectangles
    );
  }, [detection?.algo_predictions?.predictions, drawingState.drawnRectangles]);

  // Pure function to handle AI predictions import
  const handleImportPredictions = () => {
    if (!detection?.algo_predictions?.predictions) return;
    
    // Use pure filtering function
    const validPredictions = filterValidPredictions(detection.algo_predictions.predictions);
    
    if (validPredictions.length === 0) return;
    
    // Convert to drawn rectangles using pure transformation
    const importedRectangles = validPredictions.map((pred, index) => ({
      id: `imported-${Date.now()}-${index}`,
      xyxyn: pred.xyxyn as readonly [number, number, number, number],
      smokeType: selectedSmokeType
    }));
    
    // Update state using action from hook
    drawingActions.importRectangles(importedRectangles);
  };

  // Pure function to handle save using composition
  const handleSave = () => {
    if (!onSave) return;
    
    // Pure data transformation
    const saveData = {
      detection: detection?.id,
      rectangles: drawingState.drawnRectangles.map(rect => ({
        coordinates: rect.xyxyn,
        smokeType: rect.smokeType,
        id: rect.id
      })),
      transform: {
        zoom: transformState.zoomLevel,
        pan: transformState.panOffset
      },
      metadata: {
        shortcutsUsed: shortcuts.length,
        totalRectangles: drawingState.drawnRectangles.length
      }
    };
    
    onSave(saveData);
  };

  if (!detection) {
    return (
      <div className="p-8 text-center">
        <p className="text-gray-600">No detection data available</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header with controls */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">
            Refactored Annotation Interface
          </h1>
          
          <div className="flex items-center space-x-4">
            {/* Smoke type selector using pure styling functions */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Smoke Type:</label>
              <select
                value={selectedSmokeType}
                onChange={(e) => setSelectedSmokeType(e.target.value as SmokeType)}
                className="border border-gray-300 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {(['wildfire', 'industrial', 'other'] as SmokeType[]).map(type => {
                  const label = getSmokeTypeLabel(type);
                  return (
                    <option key={type} value={type}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
            
            {/* Controls */}
            <button
              onClick={() => setShowPredictions(!showPredictions)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                showPredictions 
                  ? 'bg-blue-100 text-blue-700 hover:bg-blue-200' 
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {showPredictions ? 'Hide' : 'Show'} Predictions
            </button>
            
            {importablePredictionCount > 0 && (
              <button
                onClick={handleImportPredictions}
                className="px-3 py-1 text-sm bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors"
              >
                Import AI ({importablePredictionCount})
              </button>
            )}
            
            <button
              onClick={() => drawingActions.setDrawMode(!drawingState.isDrawMode)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                drawingState.isDrawMode
                  ? 'bg-green-100 text-green-700 hover:bg-green-200'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {drawingState.isDrawMode ? 'Exit' : 'Enter'} Draw Mode
            </button>
            
            <button
              onClick={handleSave}
              disabled={drawingState.drawnRectangles.length === 0}
              className="px-4 py-1 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Save
            </button>
          </div>
        </div>
        
        {/* Status bar using pure calculations */}
        <div className="mt-2 flex items-center justify-between text-sm text-gray-600">
          <div className="flex items-center space-x-4">
            <span>Rectangles: {drawingState.drawnRectangles.length}</span>
            <span>Zoom: {Math.round(transformState.zoomLevel * 100)}%</span>
            <span>Shortcuts: {shortcutsEnabled ? 'Enabled' : 'Disabled'}</span>
          </div>
          <div className="text-xs text-gray-500">
            Press ? for keyboard shortcuts
          </div>
        </div>
      </div>

      {/* Main image area */}
      <div className="flex-1 relative">
        <div
          ref={containerRef}
          className="w-full h-full flex items-center justify-center bg-gray-100 cursor-crosshair"
          onWheel={(e) => {
            if (imageRef.current) {
              const rect = imageRef.current.getBoundingClientRect();
              transformActions.handleWheel(e.nativeEvent, rect);
            }
          }}
          // Drawing event handlers would go here in a complete implementation
        >
          {detection && (
            <>
              <img
                ref={imageRef}
                src={`/api/detections/${detection.id}/image`} // Example URL
                alt={`Detection ${detection.id}`}
                className="max-w-full max-h-full object-contain"
                onLoad={updateImageInfo}
              />

              {/* Pure component overlays */}
              {showPredictions && imageInfo && (
                <BoundingBoxOverlay
                  detection={detection}
                  imageInfo={imageInfo}
                  className="transition-opacity duration-300"
                  showConfidence={true}
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
                  className="transition-opacity duration-300"
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* Footer with statistics using pure selectors */}
      <div className="bg-white border-t border-gray-200 p-4">
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-6">
            {(['wildfire', 'industrial', 'other'] as SmokeType[]).map(type => {
              const count = drawingState.drawnRectangles.filter(r => r.smokeType === type).length;
              const colors = getSmokeTypeColors(type);
              const label = getSmokeTypeLabel(type);
              
              return (
                <div key={type} className="flex items-center space-x-2">
                  <div className={`w-3 h-3 rounded ${colors.border} ${colors.background}`}></div>
                  <span>{label}: {count}</span>
                </div>
              );
            })}
          </div>
          
          <div className="text-gray-500">
            Detection ID: {detection.id} | 
            Valid Predictions: {detection.algo_predictions?.predictions ? 
              filterValidPredictions(detection.algo_predictions.predictions).length : 0
            }
          </div>
        </div>
      </div>
    </div>
  );
};

// Apply HOCs for enhanced functionality
const EnhancedExampleComponent = withKeyboardShortcuts(
  withLoadingState(
    withImageInfo(ExampleComponent, { autoResize: true }),
    { minLoadingTime: 300, showRetry: true }
  ),
  { global: false }
);

/**
 * Main page component demonstrating the refactored approach
 */
export default function RefactoredExamplePage() {
  const [selectedDetection, setSelectedDetection] = useState<Detection | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Use refactored store with functional actions
  const store = useSequenceStoreRefactored();
  
  // Example detection data (would come from API in real app)
  const mockDetection: Detection = {
    id: 123,
    sequence_id: 456,
    alert_api_id: 789,
    created_at: new Date().toISOString(),
    recorded_at: new Date().toISOString(),
    last_modified_at: null,
    algo_predictions: {
      predictions: [
        {
          xyxyn: [0.1, 0.2, 0.8, 0.7],
          confidence: 0.85,
          class_name: 'smoke'
        },
        {
          xyxyn: [0.2, 0.3, 0.6, 0.5],
          confidence: 0.45,
          class_name: 'smoke'
        }
      ]
    }
  };

  // Load example detection on mount
  useEffect(() => {
    setIsLoading(true);
    // Simulate API call
    setTimeout(() => {
      setSelectedDetection(mockDetection);
      setIsLoading(false);
    }, 1000);
  }, []);

  // Pure function for handling save
  const handleSave = (data: any) => {
    console.log('Saving annotation data:', data);
    // In real app, this would call API
  };

  return (
    <div className="w-full h-screen">
      <EnhancedExampleComponent
        detection={selectedDetection}
        onSave={handleSave}
        isLoading={isLoading}
        error={error}
      />
    </div>
  );
}