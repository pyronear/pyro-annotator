/**
 * Annotation toolbar with floating overlay controls for ImageModal.
 * Provides tools for drawing mode, smoke type selection, and annotation actions.
 * Designed to match the ImageModal's backdrop blur circular button style.
 */

import { Square, Trash2, RotateCcw, Brain } from 'lucide-react';
import { SmokeType } from '@/types/api';
import { SmokeTypeSelector } from '@/components/annotation/SmokeTypeSelector';
import { DrawnRectangle } from '@/utils/annotation';

interface AnnotationToolbarProps {
  isDrawMode: boolean;
  isActivelyDrawing: boolean;
  onDrawModeToggle: () => void;
  selectedSmokeType: SmokeType;
  onSmokeTypeChange: (type: SmokeType) => void;
  drawnRectangles: DrawnRectangle[];
  selectedRectangleId: string | null;
  onDeleteRectangles: () => void;
  onImportPredictions: () => void;
  onResetZoom: () => void;
  canImportPredictions: boolean;
  newPredictionsCount?: number;
  zoomLevel: number;
  onSelectedRectangleSmokeTypeChange?: (smokeType: SmokeType) => void;
}

export function AnnotationToolbar({
  isDrawMode,
  isActivelyDrawing,
  onDrawModeToggle,
  selectedSmokeType,
  onSmokeTypeChange,
  drawnRectangles,
  selectedRectangleId,
  onDeleteRectangles,
  onImportPredictions,
  onResetZoom,
  canImportPredictions,
  newPredictionsCount = 0,
  zoomLevel,
  onSelectedRectangleSmokeTypeChange,
}: AnnotationToolbarProps) {
  const hasRectangles = drawnRectangles.length > 0;

  return (
    <div className="mt-4 flex justify-end">
      <div className="flex items-center space-x-2">
        {/* Smoke Type Selector */}
        <SmokeTypeSelector
          selectedSmokeType={selectedSmokeType}
          selectedRectangleSmokeType={
            selectedRectangleId
              ? drawnRectangles.find(r => r.id === selectedRectangleId)?.smokeType
              : undefined
          }
          hasSelectedRectangle={!!selectedRectangleId}
          onSmokeTypeChange={onSmokeTypeChange}
          onSelectedRectangleSmokeTypeChange={onSelectedRectangleSmokeTypeChange}
          size="md"
        />

        {/* AI Import Button */}
        <button
          onClick={onImportPredictions}
          disabled={!canImportPredictions}
          className="p-2 bg-white bg-opacity-10 hover:bg-opacity-20 disabled:bg-opacity-5 disabled:cursor-not-allowed rounded-full transition-colors backdrop-blur-sm"
          title={
            newPredictionsCount === 0
              ? 'No AI predictions available'
              : canImportPredictions
                ? `Import ${newPredictionsCount} new AI predictions as ${selectedSmokeType} smoke (A)`
                : 'All AI predictions already imported'
          }
        >
          <Brain className={`w-5 h-5 ${canImportPredictions ? 'text-white' : 'text-gray-500'}`} />
        </button>

        {/* Drawing Mode Toggle */}
        <button
          onClick={onDrawModeToggle}
          className={`p-2 rounded-full transition-colors backdrop-blur-sm ${
            isActivelyDrawing
              ? 'bg-green-500 bg-opacity-40 hover:bg-opacity-50 ring-2 ring-green-400'
              : isDrawMode
                ? 'bg-green-500 bg-opacity-20 hover:bg-opacity-30'
                : 'bg-white bg-opacity-10 hover:bg-opacity-20'
          }`}
          title={
            isActivelyDrawing
              ? 'Drawing in progress... (Click to finish, Esc to cancel)'
              : isDrawMode
                ? `Draw Mode Active (D to exit)${selectedRectangleId ? ' • Rectangle selected' : ''}${drawnRectangles.length > 0 ? ` • ${drawnRectangles.length} rectangles` : ''} • Click rectangles to select`
                : `Enter Draw Mode (D)${drawnRectangles.length > 0 ? ` • Click any of ${drawnRectangles.length} rectangles to select` : ''}`
          }
        >
          <Square className={`w-5 h-5 ${isDrawMode ? 'text-green-400' : 'text-white'}`} />
        </button>

        {/* Delete Button - Smart delete (selected or all) */}
        {hasRectangles && (
          <button
            onClick={onDeleteRectangles}
            className="p-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors backdrop-blur-sm"
            title={
              selectedRectangleId
                ? 'Delete Selected Rectangle (Delete/Backspace)'
                : `Delete All ${drawnRectangles.length} Rectangles (Delete/Backspace) • Select a rectangle to delete individually`
            }
          >
            <Trash2 className="w-5 h-5 text-white" />
          </button>
        )}

        {/* Reset Zoom Button - Only visible when zoomed */}
        {zoomLevel > 1.0 && (
          <button
            onClick={onResetZoom}
            className="p-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors backdrop-blur-sm"
            title="Reset Zoom (R)"
          >
            <RotateCcw className="w-6 h-6 text-white" />
          </button>
        )}
      </div>
    </div>
  );
}
