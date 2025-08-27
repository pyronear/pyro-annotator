/**
 * Annotation toolbar with drawing controls and actions.
 * Provides tools for drawing mode, smoke type selection, and annotation actions.
 */

import { MousePointer, Square, Eye, EyeOff, Upload, Trash2, Undo, RotateCcw, Keyboard } from 'lucide-react';
import { SmokeType } from '@/types/api';
import { SmokeTypeSelector } from '@/components/annotation/SmokeTypeSelector';
import { DrawnRectangle } from '@/utils/annotation';

interface AnnotationToolbarProps {
  isDrawMode: boolean;
  onDrawModeToggle: () => void;
  showPredictions: boolean;
  onTogglePredictions: () => void;
  selectedSmokeType: SmokeType;
  onSmokeTypeChange: (type: SmokeType) => void;
  drawnRectangles: DrawnRectangle[];
  selectedRectangleId: string | null;
  onDeleteRectangles: () => void;
  onUndo: () => void;
  onImportPredictions: () => void;
  onResetZoom: () => void;
  onShowKeyboardShortcuts: () => void;
  canUndo: boolean;
  canImportPredictions: boolean;
  newPredictionsCount?: number;
}

export function AnnotationToolbar({
  isDrawMode,
  onDrawModeToggle,
  showPredictions,
  onTogglePredictions,
  selectedSmokeType,
  onSmokeTypeChange,
  drawnRectangles,
  selectedRectangleId,
  onDeleteRectangles,
  onUndo,
  onImportPredictions,
  onResetZoom,
  onShowKeyboardShortcuts,
  canUndo,
  canImportPredictions,
  newPredictionsCount = 0
}: AnnotationToolbarProps) {
  const hasRectangles = drawnRectangles.length > 0;
  
  return (
    <div className="bg-white border-b border-gray-200 px-4 py-3">
      <div className="flex items-center justify-between">
        {/* Left side - Drawing mode and visibility controls */}
        <div className="flex items-center space-x-3">
          {/* Drawing Mode Toggle */}
          <button
            onClick={onDrawModeToggle}
            className={`
              flex items-center space-x-2 px-3 py-2 rounded-lg border transition-colors
              ${isDrawMode 
                ? 'bg-blue-50 border-blue-200 text-blue-700' 
                : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
              }
            `}
            title={isDrawMode ? 'Switch to selection mode (D)' : 'Switch to drawing mode (D)'}
          >
            {isDrawMode ? (
              <>
                <Square className="w-4 h-4" />
                <span className="text-sm font-medium">Drawing</span>
              </>
            ) : (
              <>
                <MousePointer className="w-4 h-4" />
                <span className="text-sm font-medium">Selection</span>
              </>
            )}
          </button>

          {/* Predictions Toggle */}
          <button
            onClick={onTogglePredictions}
            className={`
              flex items-center space-x-2 px-3 py-2 rounded-lg border transition-colors
              ${showPredictions
                ? 'bg-green-50 border-green-200 text-green-700'
                : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
              }
            `}
            title={showPredictions ? 'Hide AI predictions (V)' : 'Show AI predictions (V)'}
          >
            {showPredictions ? (
              <>
                <Eye className="w-4 h-4" />
                <span className="text-sm font-medium">AI Visible</span>
              </>
            ) : (
              <>
                <EyeOff className="w-4 h-4" />
                <span className="text-sm font-medium">AI Hidden</span>
              </>
            )}
          </button>

          {/* Smoke Type Selector */}
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600 font-medium">Smoke Type:</span>
            <SmokeTypeSelector
              selectedSmokeType={selectedSmokeType}
              hasSelectedRectangle={false}
              onSmokeTypeChange={onSmokeTypeChange}
              size="sm"
            />
          </div>
        </div>

        {/* Right side - Action buttons */}
        <div className="flex items-center space-x-2">
          {/* Import AI Predictions */}
          <button
            onClick={onImportPredictions}
            disabled={!canImportPredictions}
            className={`
              flex items-center space-x-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
              ${canImportPredictions
                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
              }
            `}
            title={`Import AI predictions (U)${newPredictionsCount > 0 ? ` - ${newPredictionsCount} new` : ''}`}
          >
            <Upload className="w-4 h-4" />
            <span>Import AI</span>
            {newPredictionsCount > 0 && (
              <span className="bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 min-w-5">
                {newPredictionsCount}
              </span>
            )}
          </button>

          {/* Delete Rectangles */}
          <button
            onClick={onDeleteRectangles}
            disabled={!hasRectangles}
            className={`
              flex items-center space-x-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors
              ${hasRectangles
                ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100'
                : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
              }
            `}
            title={
              selectedRectangleId 
                ? 'Delete selected rectangle (Delete/X)' 
                : hasRectangles 
                  ? 'Delete all rectangles (Delete/X)'
                  : 'No rectangles to delete'
            }
          >
            <Trash2 className="w-4 h-4" />
            <span>
              {selectedRectangleId ? 'Delete Selected' : 'Delete All'}
            </span>
          </button>

          {/* Undo */}
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className={`
              flex items-center space-x-1 px-2 py-2 rounded-lg border transition-colors
              ${canUndo
                ? 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                : 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed'
              }
            `}
            title="Undo last action (Ctrl+Z)"
          >
            <Undo className="w-4 h-4" />
          </button>

          {/* Reset Zoom */}
          <button
            onClick={onResetZoom}
            className="flex items-center space-x-1 px-2 py-2 rounded-lg border bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors"
            title="Reset zoom (R)"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Keyboard Shortcuts */}
          <button
            onClick={onShowKeyboardShortcuts}
            className="flex items-center space-x-1 px-2 py-2 rounded-lg border bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100 transition-colors"
            title="Show keyboard shortcuts (? or H)"
          >
            <Keyboard className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Status Bar */}
      <div className="mt-3 pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between text-sm text-gray-600">
          <div className="flex items-center space-x-4">
            <span>
              {hasRectangles ? `${drawnRectangles.length} annotation${drawnRectangles.length > 1 ? 's' : ''}` : 'No annotations'}
            </span>
            
            {selectedRectangleId && (
              <span className="text-blue-600 font-medium">
                Rectangle selected
              </span>
            )}
          </div>

          <div className="flex items-center space-x-4">
            <span>
              Mode: <span className="font-medium">{isDrawMode ? 'Drawing' : 'Selection'}</span>
            </span>
            
            <span>
              Type: <span className="font-medium capitalize">{selectedSmokeType}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}