import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, X, ChevronLeft, ChevronRight, CheckCircle, AlertCircle, Upload, RotateCcw, Square, Trash2, Keyboard, Eye, MousePointer, Undo, Navigation } from 'lucide-react';
import { useSequenceDetections } from '@/hooks/useSequenceDetections';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { apiClient } from '@/services/api';
import { QUERY_KEYS } from '@/utils/constants';
import {
  analyzeSequenceAccuracy,
  getFalsePositiveEmoji,
  formatFalsePositiveType,
  getModelAccuracyBadgeClasses
} from '@/utils/modelAccuracy';
import { Detection, DetectionAnnotation, AlgoPrediction } from '@/types/api';

// Drawing-related interfaces
interface DrawnRectangle {
  id: string;
  xyxyn: [number, number, number, number]; // normalized coordinates
}

interface CurrentDrawing {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

// Component for rendering bounding boxes over detection images
interface BoundingBoxOverlayProps {
  detection: Detection;
  imageInfo: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  };
}

function BoundingBoxOverlay({ detection, imageInfo }: BoundingBoxOverlayProps) {
  if (!detection?.algo_predictions?.predictions) return null;

  return (
    <>
      {detection.algo_predictions.predictions.map((prediction: AlgoPrediction, index: number) => {
        // Convert normalized coordinates (xyxyn) to pixel coordinates
        const [x1, y1, x2, y2] = prediction.xyxyn;

        // Ensure x2 > x1 and y2 > y1
        if (x2 <= x1 || y2 <= y1) {
          return null;
        }

        // Calculate pixel coordinates relative to the actual image position
        const left = imageInfo.offsetX + (x1 * imageInfo.width);
        const top = imageInfo.offsetY + (y1 * imageInfo.height);
        const width = (x2 - x1) * imageInfo.width;
        const height = (y2 - y1) * imageInfo.height;

        return (
          <div
            key={`bbox-${detection.id}-${index}`}
            className="absolute border-2 border-red-500 bg-red-500/20 pointer-events-none"
            style={{
              left: `${left}px`,
              top: `${top}px`,
              width: `${width}px`,
              height: `${height}px`,
            }}
          >
            {/* Confidence label */}
            <div className="absolute -top-6 left-0 bg-red-500 text-white text-xs px-1 py-0.5 rounded whitespace-nowrap">
              {prediction.class_name} {(prediction.confidence * 100).toFixed(0)}%
            </div>
          </div>
        );
      }).filter(Boolean)} {/* Remove null entries from invalid boxes */}
    </>
  );
}

// Component for rendering user-drawn rectangles
interface DrawingOverlayProps {
  drawnRectangles: DrawnRectangle[];
  currentDrawing: CurrentDrawing | null;
  selectedRectangleId: string | null;
  imageInfo: {
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  };
  zoomLevel: number;
  panOffset: { x: number; y: number };
  transformOrigin: { x: number; y: number };
  isDragging: boolean;
  normalizedToImage: (normX: number, normY: number) => { x: number; y: number };
}

function DrawingOverlay({ 
  drawnRectangles, 
  currentDrawing, 
  selectedRectangleId,
  imageInfo, 
  zoomLevel, 
  panOffset, 
  transformOrigin, 
  isDragging,
  normalizedToImage 
}: DrawingOverlayProps) {
  
  const renderRectangle = (rect: { xyxyn: [number, number, number, number]; id?: string } | CurrentDrawing, type: 'completed' | 'drawing') => {
    let left: number, top: number, width: number, height: number;
    
    if (type === 'completed') {
      // For completed rectangles, use normalized coordinates
      const rectData = rect as { xyxyn: [number, number, number, number]; id: string };
      const [x1, y1, x2, y2] = rectData.xyxyn;
      const topLeft = normalizedToImage(x1, y1);
      const bottomRight = normalizedToImage(x2, y2);
      
      left = imageInfo.offsetX + topLeft.x;
      top = imageInfo.offsetY + topLeft.y;
      width = bottomRight.x - topLeft.x;
      height = bottomRight.y - topLeft.y;
    } else {
      // For current drawing, use image coordinates directly
      const drawingData = rect as CurrentDrawing;
      const minX = Math.min(drawingData.startX, drawingData.currentX);
      const minY = Math.min(drawingData.startY, drawingData.currentY);
      const maxX = Math.max(drawingData.startX, drawingData.currentX);
      const maxY = Math.max(drawingData.startY, drawingData.currentY);
      
      left = imageInfo.offsetX + minX;
      top = imageInfo.offsetY + minY;
      width = maxX - minX;
      height = maxY - minY;
    }
    
    // Determine styling based on selection state
    const isSelected = type === 'completed' && selectedRectangleId === (rect as any).id;
    const borderColor = isSelected ? 'border-blue-500' : 'border-green-500';
    const backgroundColor = isSelected ? 'bg-blue-500/20' : 'bg-green-500/10';
    const borderWidth = isSelected ? 'border-4' : 'border-2';
    
    // Make completed rectangles clickable, but keep drawing preview non-interactive
    const pointerEvents = type === 'completed' ? 'pointer-events-auto' : 'pointer-events-none';
    const cursorStyle = type === 'completed' ? 'cursor-pointer' : '';
    const hoverEffect = type === 'completed' ? 'hover:brightness-110' : '';
    
    return (
      <div
        key={type === 'completed' ? (rect as any).id : 'current-drawing'}
        className={`absolute ${borderWidth} ${borderColor} ${backgroundColor} ${pointerEvents} ${cursorStyle} ${hoverEffect} transition-all duration-150`}
        style={{
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
        }}
        title={type === 'completed' ? 'Click to select rectangle' : undefined}
      />
    );
  };
  
  return (
    <div 
      className="absolute inset-0 pointer-events-none"
      style={{
        transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
        transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
        transition: isDragging ? 'none' : 'transform 0.1s ease-out'
      }}
    >
      {/* Completed rectangles */}
      {drawnRectangles.map(rect => renderRectangle(rect, 'completed'))}
      
      {/* Current drawing rectangle */}
      {currentDrawing && renderRectangle(currentDrawing, 'drawing')}
    </div>
  );
}

// Keyboard Shortcuts Info Component
interface KeyboardShortcutsInfoProps {
  isVisible: boolean;
  onClose: () => void;
  isDrawMode: boolean;
  hasRectangles: boolean;
  hasUndoHistory: boolean;
  isAnnotated: boolean;
}

function KeyboardShortcutsInfo({ 
  isVisible, 
  onClose, 
  isDrawMode, 
  hasRectangles, 
  hasUndoHistory, 
  isAnnotated 
}: KeyboardShortcutsInfoProps) {
  if (!isVisible) return null;

  // Handle escape key for this modal specifically
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  // Handle overlay click with proper event stopping
  const handleOverlayClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  };

  // Prevent modal content clicks from propagating
  const handleContentClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const KeyShortcut = ({ keys, description, icon, disabled = false }: { 
    keys: string[]; 
    description: string; 
    icon?: React.ReactNode; 
    disabled?: boolean;
  }) => (
    <div className={`flex items-center space-x-3 py-2 px-3 rounded-md ${disabled ? 'opacity-50' : 'hover:bg-white/5'}`}>
      <div className="flex items-center space-x-1 min-w-20">
        {keys.map((key, index) => (
          <span key={index}>
            <kbd className="px-2 py-1 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-md">
              {key}
            </kbd>
            {index < keys.length - 1 && <span className="text-gray-400 mx-1">+</span>}
          </span>
        ))}
      </div>
      <div className="flex items-center space-x-2 flex-1">
        {icon && <div className="text-gray-400 w-4 h-4">{icon}</div>}
        <span className="text-sm text-white">{description}</span>
      </div>
    </div>
  );

  return (
    <div 
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-60"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div 
        className="bg-gray-900 border border-gray-700 rounded-lg p-6 max-w-md w-full mx-4 max-h-96 overflow-y-auto"
        onClick={handleContentClick}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-2">
            <Keyboard className="w-5 h-5 text-primary-400" />
            <h3 className="text-lg font-semibold text-white">Keyboard Shortcuts</h3>
          </div>
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            }}
            className="p-1 hover:bg-white/10 rounded-full transition-colors"
          >
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="space-y-4">
          {/* Navigation */}
          <div>
            <h4 className="text-sm font-medium text-primary-300 mb-2 flex items-center space-x-2">
              <Navigation className="w-4 h-4" />
              <span>Navigation</span>
            </h4>
            <div className="space-y-1">
              <KeyShortcut keys={["←"]} description="Previous detection" />
              <KeyShortcut keys={["→"]} description="Next detection" />
              <KeyShortcut keys={["Esc"]} description="Close modal" />
            </div>
          </div>

          {/* View Controls */}
          <div>
            <h4 className="text-sm font-medium text-primary-300 mb-2 flex items-center space-x-2">
              <Eye className="w-4 h-4" />
              <span>View Controls</span>
            </h4>
            <div className="space-y-1">
              <KeyShortcut keys={["P"]} description="Toggle predictions" icon={<Eye className="w-4 h-4" />} />
              <KeyShortcut keys={["R"]} description="Reset zoom" />
            </div>
          </div>

          {/* Drawing Tools */}
          <div>
            <h4 className="text-sm font-medium text-primary-300 mb-2 flex items-center space-x-2">
              <MousePointer className="w-4 h-4" />
              <span>Drawing Tools</span>
            </h4>
            <div className="space-y-1">
              <KeyShortcut 
                keys={["D"]} 
                description={isDrawMode ? "Exit draw mode" : "Enter draw mode"} 
                icon={<Square className="w-4 h-4" />} 
              />
              <KeyShortcut 
                keys={["Del", "⌫"]} 
                description={hasRectangles ? "Delete rectangles" : "Delete rectangles"} 
                icon={<Trash2 className="w-4 h-4" />}
                disabled={!hasRectangles}
              />
              <KeyShortcut 
                keys={["Ctrl", "Z"]} 
                description="Undo" 
                icon={<Undo className="w-4 h-4" />}
                disabled={!hasUndoHistory}
              />
            </div>
          </div>

          {/* Actions */}
          <div>
            <h4 className="text-sm font-medium text-primary-300 mb-2">Actions</h4>
            <div className="space-y-1">
              <KeyShortcut 
                keys={["Space"]} 
                description={isAnnotated ? "Update annotation" : "Submit annotation"} 
              />
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-gray-700">
          <p className="text-xs text-gray-400 text-center">
            Press <kbd className="px-1 py-0.5 text-xs bg-gray-700 rounded">?</kbd> or <kbd className="px-1 py-0.5 text-xs bg-gray-700 rounded">H</kbd> to toggle shortcuts
          </p>
        </div>
      </div>
    </div>
  );
}

interface DetectionImageCardProps {
  detection: Detection;
  onClick: () => void;
  isAnnotated?: boolean;
  showPredictions?: boolean;
}

function DetectionImageCard({ detection, onClick, isAnnotated = false, showPredictions = false }: DetectionImageCardProps) {
  const { data: imageData, isLoading } = useDetectionImage(detection.id);
  const [imageInfo, setImageInfo] = useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Handle image load to get dimensions and position using DOM positioning
  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      // Get actual rendered positions from DOM
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();

      // Calculate the image position relative to the container
      const offsetX = imgRect.left - containerRect.left;
      const offsetY = imgRect.top - containerRect.top;

      // Use the actual rendered dimensions
      const width = imgRect.width;
      const height = imgRect.height;

      setImageInfo({
        width: width,
        height: height,
        offsetX: offsetX,
        offsetY: offsetY
      });
    }
  };

  if (isLoading) {
    return (
      <div className="aspect-video bg-gray-200 animate-pulse rounded-lg">
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (!imageData?.url) {
    return (
      <div className="aspect-video bg-gray-100 border border-gray-200 rounded-lg flex items-center justify-center">
        <span className="text-gray-400 text-sm">No Image</span>
      </div>
    );
  }

  return (
    <div className="group cursor-pointer" onClick={onClick}>
      <div
        ref={containerRef}
        className={`relative aspect-video overflow-hidden rounded-lg border-2 transition-colors ${isAnnotated
          ? 'border-green-500 hover:border-green-600'
          : 'border-blue-500 hover:border-blue-600'
          }`}
      >
        <img
          ref={imgRef}
          src={imageData.url}
          alt={`Detection ${detection.id}`}
          className="w-full h-full object-contain bg-gray-50 group-hover:bg-gray-100 transition-colors"
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

        {/* Bounding Boxes Overlay */}
        {showPredictions && imageInfo && (
          <div className="absolute inset-0 pointer-events-none">
            <BoundingBoxOverlay detection={detection} imageInfo={imageInfo} />
          </div>
        )}
      </div>
      <div className="mt-2 text-sm text-gray-600">
        <div className="flex items-center justify-between">
          {isAnnotated && <CheckCircle className="w-4 h-4 text-green-500" />}
        </div>
        <p className="text-xs text-gray-500">
          {new Date(detection.recorded_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}

interface ImageModalProps {
  detection: Detection;
  onClose: () => void;
  onNavigate: (direction: 'prev' | 'next') => void;
  onSubmit: (detection: Detection, drawnRectangles: DrawnRectangle[]) => void;
  onTogglePredictions: (show: boolean) => void;
  canNavigatePrev: boolean;
  canNavigateNext: boolean;
  currentIndex: number;
  totalCount: number;
  showPredictions?: boolean;
  isSubmitting?: boolean;
  isAnnotated?: boolean;
  existingAnnotation?: DetectionAnnotation | null;
}

function ImageModal({
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
  existingAnnotation = null
}: ImageModalProps) {
  const { data: imageData } = useDetectionImage(detection.id);
  const [imageInfo, setImageInfo] = useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  
  // Zoom state management
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [transformOrigin, setTransformOrigin] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Drawing state management
  const [isDrawMode, setIsDrawMode] = useState(false);
  const [isActivelyDrawing, setIsActivelyDrawing] = useState(false);
  const [drawnRectangles, setDrawnRectangles] = useState<DrawnRectangle[]>([]);
  const [currentDrawing, setCurrentDrawing] = useState<CurrentDrawing | null>(null);
  const [selectedRectangleId, setSelectedRectangleId] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<DrawnRectangle[][]>([]);
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

  // Handle image load to get dimensions and position using DOM positioning
  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      // Get actual rendered positions from DOM
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();

      // Calculate the image position relative to the container
      const offsetX = imgRect.left - containerRect.left;
      const offsetY = imgRect.top - containerRect.top;

      // Use the actual rendered dimensions
      const width = imgRect.width;
      const height = imgRect.height;

      setImageInfo({
        width: width,
        height: height,
        offsetX: offsetX,
        offsetY: offsetY
      });
    }
  };

  // Reset zoom and drawing when detection changes, load existing annotations
  useEffect(() => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
    setTransformOrigin({ x: 50, y: 50 });
    setIsDrawMode(false);
    setIsActivelyDrawing(false);
    setCurrentDrawing(null);
    setSelectedRectangleId(null);
    setUndoStack([]);
    
    // Load existing annotation rectangles if available
    if (existingAnnotation?.annotation?.annotation) {
      const existingRects: DrawnRectangle[] = existingAnnotation.annotation.annotation.map((item, index) => ({
        id: `existing-${index}`,
        xyxyn: item.xyxyn
      }));
      setDrawnRectangles(existingRects);
    } else {
      setDrawnRectangles([]);
    }
  }, [detection.id, existingAnnotation]);

  // Coordinate transformation functions
  const screenToImageCoordinates = (screenX: number, screenY: number) => {
    if (!imgRef.current || !containerRef.current) return { x: 0, y: 0 };
    
    const containerRect = containerRef.current.getBoundingClientRect();
    
    // Get mouse position relative to container
    const relativeX = screenX - containerRect.left;
    const relativeY = screenY - containerRect.top;
    
    // Get original image dimensions and position (before any transforms)
    const img = imgRef.current;
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    // Calculate original image bounds using object-contain logic
    const imgAspectRatio = img.naturalWidth / img.naturalHeight;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let originalWidth: number, originalHeight: number, originalX: number, originalY: number;
    
    if (imgAspectRatio > containerAspectRatio) {
      // Image is wider - fit to width
      originalWidth = containerWidth;
      originalHeight = containerWidth / imgAspectRatio;
      originalX = 0;
      originalY = (containerHeight - originalHeight) / 2;
    } else {
      // Image is taller - fit to height
      originalWidth = containerHeight * imgAspectRatio;
      originalHeight = containerHeight;
      originalX = (containerWidth - originalWidth) / 2;
      originalY = 0;
    }
    
    // Calculate transform origin in original image pixel coordinates
    const originX = (transformOrigin.x / 100) * originalWidth;
    const originY = (transformOrigin.y / 100) * originalHeight;
    
    // Transform origin in container coordinates
    const originContainerX = originalX + originX;
    const originContainerY = originalY + originY;
    
    // Reverse the CSS transform: scale(zoomLevel) translate(panOffset.x, panOffset.y)
    // Step 1: Reverse translation (panOffset is applied in scaled coordinate space)
    const afterTranslateX = relativeX - panOffset.x;
    const afterTranslateY = relativeY - panOffset.y;
    
    // Step 2: Reverse scaling around transform origin
    const imageX = (afterTranslateX - originContainerX) / zoomLevel + originContainerX - originalX;
    const imageY = (afterTranslateY - originContainerY) / zoomLevel + originContainerY - originalY;
    
    return { x: imageX, y: imageY };
  };

  const imageToNormalized = (imageX: number, imageY: number) => {
    if (!imgRef.current || !containerRef.current) return { x: 0, y: 0 };
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const img = imgRef.current;
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    // Calculate original image bounds using object-contain logic
    const imgAspectRatio = img.naturalWidth / img.naturalHeight;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let originalWidth: number, originalHeight: number;
    
    if (imgAspectRatio > containerAspectRatio) {
      // Image is wider - fit to width
      originalWidth = containerWidth;
      originalHeight = containerWidth / imgAspectRatio;
    } else {
      // Image is taller - fit to height
      originalWidth = containerHeight * imgAspectRatio;
      originalHeight = containerHeight;
    }
    
    return {
      x: Math.max(0, Math.min(1, imageX / originalWidth)),
      y: Math.max(0, Math.min(1, imageY / originalHeight))
    };
  };

  const normalizedToImage = (normX: number, normY: number) => {
    if (!imgRef.current || !containerRef.current) return { x: 0, y: 0 };
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const img = imgRef.current;
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    // Calculate original image bounds using object-contain logic
    const imgAspectRatio = img.naturalWidth / img.naturalHeight;
    const containerAspectRatio = containerWidth / containerHeight;
    
    let originalWidth: number, originalHeight: number;
    
    if (imgAspectRatio > containerAspectRatio) {
      // Image is wider - fit to width
      originalWidth = containerWidth;
      originalHeight = containerWidth / imgAspectRatio;
    } else {
      // Image is taller - fit to height
      originalWidth = containerHeight * imgAspectRatio;
      originalHeight = containerHeight;
    }
    
    return {
      x: normX * originalWidth,
      y: normY * originalHeight
    };
  };

  // Hit testing functions for rectangle selection
  const isPointInRectangle = (pointX: number, pointY: number, rect: DrawnRectangle): boolean => {
    const topLeft = normalizedToImage(rect.xyxyn[0], rect.xyxyn[1]);
    const bottomRight = normalizedToImage(rect.xyxyn[2], rect.xyxyn[3]);
    
    return pointX >= topLeft.x && pointX <= bottomRight.x &&
           pointY >= topLeft.y && pointY <= bottomRight.y;
  };

  const getRectangleAtPoint = (x: number, y: number): DrawnRectangle | null => {
    // Check rectangles in reverse order (topmost/newest first)
    for (let i = drawnRectangles.length - 1; i >= 0; i--) {
      if (isPointInRectangle(x, y, drawnRectangles[i])) {
        return drawnRectangles[i];
      }
    }
    return null;
  };

  // Undo functionality
  const pushUndoState = () => {
    setUndoStack(prev => {
      const newStack = [...prev, [...drawnRectangles]]; // Deep copy current state
      // Limit stack size to 50 operations to prevent memory issues
      return newStack.length > 50 ? newStack.slice(1) : newStack;
    });
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    
    // Cancel any active drawing first
    if (isActivelyDrawing) {
      setCurrentDrawing(null);
      setIsActivelyDrawing(false);
    }
    
    // Pop last state and restore
    const lastState = undoStack[undoStack.length - 1];
    setDrawnRectangles(lastState);
    setUndoStack(prev => prev.slice(0, -1));
    
    // Clear selection since rectangles changed
    setSelectedRectangleId(null);
  };

  // Mouse wheel zoom handler
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    
    if (!containerRef.current || !imgRef.current) return;
    
    const imgRect = imgRef.current.getBoundingClientRect();
    
    // Calculate mouse position relative to the image
    const mouseX = e.clientX - imgRect.left;
    const mouseY = e.clientY - imgRect.top;
    
    // Convert to percentage for transform-origin
    const originX = (mouseX / imgRect.width) * 100;
    const originY = (mouseY / imgRect.height) * 100;
    
    setTransformOrigin({ x: originX, y: originY });
    
    // Calculate new zoom level
    const zoomDelta = e.deltaY < 0 ? 0.2 : -0.2;
    const newZoomLevel = Math.max(1.0, Math.min(4.0, zoomLevel + zoomDelta));
    
    setZoomLevel(newZoomLevel);
    
    // Reset pan if zoomed back to 1x
    if (newZoomLevel === 1.0) {
      setPanOffset({ x: 0, y: 0 });
      setTransformOrigin({ x: 50, y: 50 });
    }
  };

  // Pan boundary constraint helper
  const constrainPan = (offset: { x: number, y: number }) => {
    if (!imgRef.current || zoomLevel <= 1) return offset;
    
    const imgRect = imgRef.current.getBoundingClientRect();
    const scaledWidth = imgRect.width * zoomLevel;
    const scaledHeight = imgRect.height * zoomLevel;
    
    // Calculate max pan distance to keep image centered in viewport
    const maxPanX = (scaledWidth - imgRect.width) / 2;
    const maxPanY = (scaledHeight - imgRect.height) / 2;
    
    return {
      x: Math.max(-maxPanX, Math.min(maxPanX, offset.x)),
      y: Math.max(-maxPanY, Math.min(maxPanY, offset.y))
    };
  };

  // Click-based drawing and panning handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isDrawMode && zoomLevel > 1.0) {
      // Start panning when not in draw mode
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
    // Drawing is handled by handleClick instead
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const coords = screenToImageCoordinates(e.clientX, e.clientY);
    
    // First, check if we clicked on an existing rectangle for selection
    // Selection works regardless of drawing mode - it takes priority
    const hitRectangle = getRectangleAtPoint(coords.x, coords.y);
    
    if (hitRectangle) {
      // Select the rectangle and cancel any active drawing
      setSelectedRectangleId(hitRectangle.id);
      setIsActivelyDrawing(false);
      setCurrentDrawing(null);
      return;
    }
    
    // No rectangle hit - deselect any current selection
    setSelectedRectangleId(null);
    
    // Only proceed with drawing if in drawing mode
    if (!isDrawMode) return;
    
    // Proceed with drawing logic
    if (!isActivelyDrawing) {
      // First click: Start drawing rectangle
      setCurrentDrawing({
        startX: coords.x,
        startY: coords.y,
        currentX: coords.x,
        currentY: coords.y
      });
      setIsActivelyDrawing(true);
    } else {
      // Second click: Finalize rectangle
      if (currentDrawing) {
        const startNorm = imageToNormalized(currentDrawing.startX, currentDrawing.startY);
        const endNorm = imageToNormalized(coords.x, coords.y);
        
        // Ensure we have a minimum rectangle size
        const minX = Math.min(startNorm.x, endNorm.x);
        const maxX = Math.max(startNorm.x, endNorm.x);
        const minY = Math.min(startNorm.y, endNorm.y);
        const maxY = Math.max(startNorm.y, endNorm.y);
        
        // Only create rectangle if it has meaningful size (at least 10 pixels)
        const sizeThreshold = 10 / (imgRef.current?.getBoundingClientRect().width || 1000);
        if ((maxX - minX) > sizeThreshold && (maxY - minY) > sizeThreshold) {
          // Save current state to undo stack before adding rectangle
          pushUndoState();
          
          const newRect: DrawnRectangle = {
            id: Date.now().toString(),
            xyxyn: [minX, minY, maxX, maxY]
          };
          
          setDrawnRectangles(prev => [...prev, newRect]);
        }
      }
      
      // Reset drawing state
      setCurrentDrawing(null);
      setIsActivelyDrawing(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isActivelyDrawing && currentDrawing) {
      // Update live preview rectangle
      const coords = screenToImageCoordinates(e.clientX, e.clientY);
      setCurrentDrawing(prev => prev ? { 
        ...prev, 
        currentX: coords.x, 
        currentY: coords.y 
      } : null);
    } else if (isDragging && !isDrawMode && zoomLevel > 1.0) {
      // Handle panning
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      const constrainedOffset = constrainPan({ x: newX, y: newY });
      setPanOffset(constrainedOffset);
    }
  };

  const handleMouseUp = () => {
    if (isDragging) {
      setIsDragging(false);
    }
    // Drawing finalization is handled by handleClick instead
  };

  // Reset zoom function
  const handleZoomReset = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
    setTransformOrigin({ x: 50, y: 50 });
  };

  // Keyboard handler for zoom reset, draw mode, escape, and deletion
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'r' || e.key === 'R') {
        handleZoomReset();
        e.preventDefault();
      } else if (e.key === 'd' || e.key === 'D') {
        // When toggling draw mode, cancel any active drawing
        if (isDrawMode && isActivelyDrawing) {
          setCurrentDrawing(null);
          setIsActivelyDrawing(false);
        }
        setIsDrawMode(!isDrawMode);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        // If shortcuts modal is open, close it first and prevent other actions
        if (showKeyboardShortcuts) {
          setShowKeyboardShortcuts(false);
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        // Cancel current drawing if in progress
        if (isActivelyDrawing) {
          setCurrentDrawing(null);
          setIsActivelyDrawing(false);
          e.preventDefault();
        } else if (selectedRectangleId) {
          // Deselect rectangle if one is selected and not actively drawing
          setSelectedRectangleId(null);
          e.preventDefault();
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && drawnRectangles.length > 0) {
        // Save current state to undo stack before deleting
        pushUndoState();
        
        // Smart delete: selected rectangle or all rectangles
        if (selectedRectangleId) {
          // Delete only the selected rectangle
          setDrawnRectangles(prev => prev.filter(rect => rect.id !== selectedRectangleId));
          setSelectedRectangleId(null);
        } else {
          // Delete all rectangles when none selected
          setDrawnRectangles([]);
        }
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        // Undo with Ctrl-Z (Windows/Linux) or Cmd-Z (Mac)
        handleUndo();
        e.preventDefault();
      } else if (e.key === 'p' || e.key === 'P') {
        // Toggle predictions visibility
        onTogglePredictions(!showPredictions);
        e.preventDefault();
      } else if (e.key === '?' || (e.key === 'h' && (e.ctrlKey || e.metaKey)) || (e.key === 'h' || e.key === 'H')) {
        // Toggle keyboard shortcuts info with ? key or H key
        setShowKeyboardShortcuts(!showKeyboardShortcuts);
        e.preventDefault();
      } else if (e.key === ' ' && !isSubmitting) {
        // Space key to submit/update annotation with current drawn rectangles
        onSubmit(detection, drawnRectangles);
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawMode, isActivelyDrawing, selectedRectangleId, drawnRectangles.length, undoStack.length, showKeyboardShortcuts, showPredictions, onTogglePredictions, isSubmitting, detection, drawnRectangles, onSubmit]);

  // Cursor style based on state
  const getCursorStyle = () => {
    if (isDrawMode) {
      return isActivelyDrawing ? 'crosshair' : 'crosshair';
    }
    if (zoomLevel <= 1.0) return 'default';
    return isDragging ? 'grabbing' : 'grab';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50">
      <div className="relative w-full h-full flex items-center justify-center p-4">
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors"
        >
          <X className="w-6 h-6 text-white" />
        </button>


        {/* Navigation buttons */}
        <button
          onClick={() => onNavigate('prev')}
          disabled={!canNavigatePrev}
          className={`absolute left-4 p-3 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors ${!canNavigatePrev ? 'opacity-40 cursor-not-allowed' : ''
            }`}
        >
          <ChevronLeft className="w-6 h-6 text-white" />
        </button>

        <button
          onClick={() => onNavigate('next')}
          disabled={!canNavigateNext}
          className={`absolute right-16 p-3 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors ${!canNavigateNext ? 'opacity-40 cursor-not-allowed' : ''
            }`}
        >
          <ChevronRight className="w-6 h-6 text-white" />
        </button>

        {/* Keyboard Shortcuts Info Button */}
        <button
          onClick={() => setShowKeyboardShortcuts(!showKeyboardShortcuts)}
          className="absolute top-4 left-4 p-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors backdrop-blur-sm z-50"
          title="Show keyboard shortcuts (? or H)"
        >
          <Keyboard className="w-4 h-4 text-white" />
        </button>

        {/* Predictions Toggle */}
        <label className="absolute top-4 right-20 flex items-center space-x-2 px-3 py-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-md text-xs font-medium text-white cursor-pointer backdrop-blur-sm">
          <input
            type="checkbox"
            checked={showPredictions}
            onChange={(e) => onTogglePredictions(e.target.checked)}
            className="w-3 h-3 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
          />
          <span>Show predictions</span>
        </label>

        {/* Image container */}
        <div className="relative max-w-7xl max-h-full flex flex-col items-center">
          {imageData?.url ? (
            <div
              ref={containerRef}
              className="relative overflow-hidden"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onClick={handleClick}
              style={{ cursor: getCursorStyle() }}
            >
              <img
                ref={imgRef}
                src={imageData.url}
                alt={`Detection ${detection.id}`}
                className="max-w-full max-h-[80vh] object-contain block"
                style={{
                  transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
                  transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
                  transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                }}
                onLoad={handleImageLoad}
              />

              {/* Bounding Boxes Overlay */}
              {showPredictions && imageInfo && (
                <div 
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
                    transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
                    transition: isDragging ? 'none' : 'transform 0.1s ease-out'
                  }}
                >
                  <BoundingBoxOverlay detection={detection} imageInfo={imageInfo} />
                </div>
              )}

              {/* Drawing Overlay */}
              {imageInfo && (
                <DrawingOverlay
                  drawnRectangles={drawnRectangles}
                  currentDrawing={currentDrawing}
                  selectedRectangleId={selectedRectangleId}
                  imageInfo={imageInfo}
                  zoomLevel={zoomLevel}
                  panOffset={panOffset}
                  transformOrigin={transformOrigin}
                  isDragging={isDragging || isActivelyDrawing}
                  normalizedToImage={normalizedToImage}
                />
              )}
            </div>
          ) : (
            <div className="w-96 h-96 bg-gray-800 flex items-center justify-center rounded-lg">
              <span className="text-gray-400">No image available</span>
            </div>
          )}

          {/* Control buttons - Bottom right */}
          <div className="mt-4 flex justify-end">
            <div className="flex items-center space-x-2">
              {/* Drawing Mode Toggle */}
              <button
                onClick={() => {
                  // Cancel any active drawing when toggling draw mode
                  if (isDrawMode && isActivelyDrawing) {
                    setCurrentDrawing(null);
                    setIsActivelyDrawing(false);
                  }
                  setIsDrawMode(!isDrawMode);
                }}
                className={`p-2 rounded-full transition-colors backdrop-blur-sm ${
                  isActivelyDrawing 
                    ? 'bg-green-500 bg-opacity-40 hover:bg-opacity-50 ring-2 ring-green-400' 
                    : isDrawMode 
                    ? 'bg-green-500 bg-opacity-20 hover:bg-opacity-30' 
                    : 'bg-white bg-opacity-10 hover:bg-opacity-20'
                }`}
                title={
                  isActivelyDrawing 
                    ? "Drawing in progress... (Click to finish, Esc to cancel)" 
                    : isDrawMode 
                    ? `Draw Mode Active (D to exit)${selectedRectangleId ? ' • Rectangle selected' : ''}${drawnRectangles.length > 0 ? ` • ${drawnRectangles.length} rectangles` : ''} • Click rectangles to select` 
                    : `Enter Draw Mode (D)${drawnRectangles.length > 0 ? ` • Click any of ${drawnRectangles.length} rectangles to select` : ''}`
                }
              >
                <Square className={`w-5 h-5 ${isDrawMode ? 'text-green-400' : 'text-white'}`} />
              </button>
              
              {/* Delete Button - Smart delete (selected or all) */}
              {drawnRectangles.length > 0 && (
                <button
                  onClick={() => {
                    // Save current state to undo stack before deleting
                    pushUndoState();
                    
                    if (selectedRectangleId) {
                      // Delete only the selected rectangle
                      setDrawnRectangles(prev => prev.filter(rect => rect.id !== selectedRectangleId));
                      setSelectedRectangleId(null);
                    } else {
                      // Delete all rectangles when none selected
                      setDrawnRectangles([]);
                    }
                  }}
                  className="p-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors backdrop-blur-sm"
                  title={
                    selectedRectangleId 
                      ? "Delete Selected Rectangle (Delete/Backspace)" 
                      : `Delete All ${drawnRectangles.length} Rectangles (Delete/Backspace) • Select a rectangle to delete individually`
                  }
                >
                  <Trash2 className="w-5 h-5 text-white" />
                </button>
              )}
              
              {/* Reset Zoom Button - Only visible when zoomed */}
              {zoomLevel > 1.0 && (
                <button
                  onClick={handleZoomReset}
                  className="p-2 bg-white bg-opacity-10 hover:bg-opacity-20 rounded-full transition-colors backdrop-blur-sm"
                  title="Reset Zoom (R)"
                >
                  <RotateCcw className="w-6 h-6 text-white" />
                </button>
              )}
            </div>
          </div>

          {/* Detection info */}
          <div className="mt-4 bg-white bg-opacity-10 backdrop-blur-sm rounded-lg p-4 text-white">
            <div className="flex items-center justify-center space-x-4">
              <span className="font-medium">Detection {currentIndex + 1} of {totalCount}</span>
              <span className="text-gray-300">•</span>
              <span className="text-gray-300">
                {new Date(detection.recorded_at).toLocaleString()}
              </span>
              {isAnnotated && (
                <>
                  <span className="text-gray-300">•</span>
                  <span className="text-green-300 text-sm">✓ Annotated</span>
                </>
              )}
            </div>
            
            {/* Submit Button - Centered below info */}
            <div className="flex justify-center mt-4">
              <button
                onClick={() => onSubmit(detection, drawnRectangles)}
                disabled={isSubmitting}
                className="inline-flex items-center px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:bg-primary-400 text-white text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 mr-2 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    {isAnnotated ? 'Updating...' : 'Submitting...'}
                  </>
                ) : (
                  <>
                    {isAnnotated ? 'Update' : 'Submit'}
                    <span className="ml-2 text-xs text-primary-200">(Space)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Keyboard Shortcuts Info Overlay */}
          <KeyboardShortcutsInfo
            isVisible={showKeyboardShortcuts}
            onClose={() => setShowKeyboardShortcuts(false)}
            isDrawMode={isDrawMode}
            hasRectangles={drawnRectangles.length > 0}
            hasUndoHistory={undoStack.length > 0}
            isAnnotated={isAnnotated}
          />
        </div>
      </div>
    </div>
  );
}

export default function DetectionSequenceAnnotatePage() {
  const { sequenceId } = useParams<{ sequenceId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const sequenceIdNum = sequenceId ? parseInt(sequenceId, 10) : null;

  const [selectedDetectionIndex, setSelectedDetectionIndex] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [detectionAnnotations, setDetectionAnnotations] = useState<Map<number, DetectionAnnotation>>(new Map());
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState('');
  const [showPredictions, setShowPredictions] = useState(false);

  const { data: detections, isLoading, error } = useSequenceDetections(sequenceIdNum);

  // Fetch sequence data for header info
  const { data: sequence } = useQuery({
    queryKey: QUERY_KEYS.SEQUENCE(sequenceIdNum!),
    queryFn: () => apiClient.getSequence(sequenceIdNum!),
    enabled: !!sequenceIdNum,
  });

  // Fetch sequence annotation to check the sequence-level annotation status
  const { data: sequenceAnnotationResponse } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCE_ANNOTATIONS, 'by-sequence', sequenceIdNum],
    queryFn: async () => {
      const response = await apiClient.getSequenceAnnotations({ sequence_id: sequenceIdNum!, size: 1 });
      return response.items[0] || null;
    },
    enabled: !!sequenceIdNum,
  });

  const sequenceAnnotation = sequenceAnnotationResponse;

  // Fetch all sequences for navigation (using same filters as DetectionAnnotatePage)
  const { data: allSequences } = useQuery({
    queryKey: [...QUERY_KEYS.SEQUENCES, 'navigation-context'],
    queryFn: () => apiClient.getSequences({
      detection_annotation_completion: 'incomplete',
      include_detection_stats: true,
      size: 1000, // Get enough sequences for navigation
    }),
  });

  // Fetch existing detection annotations for this sequence
  const { data: existingAnnotations } = useQuery({
    queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS, 'by-sequence', sequenceIdNum],
    queryFn: async () => {
      const response = await apiClient.getDetectionAnnotations({
        sequence_id: sequenceIdNum!,
        size: 100
      });
      return response.items;
    },
    enabled: !!sequenceIdNum,
  });

  // Initialize detection annotations map when data loads
  useEffect(() => {
    if (existingAnnotations) {
      const annotationsMap = new Map<number, DetectionAnnotation>();
      existingAnnotations.forEach(annotation => {
        annotationsMap.set(annotation.detection_id, annotation);
      });
      setDetectionAnnotations(annotationsMap);
    }
  }, [existingAnnotations]);

  // Save detection annotations mutation
  const saveAnnotations = useMutation({
    mutationFn: async () => {
      if (!detections) return;

      // Update annotations for all detections (should already exist from sequence annotation)
      const promises = detections.map(async (detection) => {
        const existingAnnotation = detectionAnnotations.get(detection.id);

        if (existingAnnotation) {
          // Update existing annotation to 'annotated' stage
          if (existingAnnotation.processing_stage !== 'annotated') {
            return apiClient.updateDetectionAnnotation(existingAnnotation.id, {
              processing_stage: 'annotated',
            });
          }
        } else {
          // No annotation exists - skip this detection with a warning
          console.warn(`No detection annotation found for detection ${detection.id}. Skipping.`);
          return null;
        }
      });

      const results = await Promise.all(promises);
      return results.filter(Boolean); // Remove null results
    },
    onSuccess: () => {
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS] });
      // Invalidate annotation counts to update sidebar badges
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
      setToastMessage('Detection annotations saved successfully');
      setShowToast(true);

      // Navigate back after a short delay
      setTimeout(() => {
        navigate('/detections/annotate');
      }, 1500);
    },
    onError: () => {
      setToastMessage('Failed to save annotations');
      setShowToast(true);
    },
  });

  // Individual detection annotation mutation
  const annotateIndividualDetection = useMutation({
    mutationFn: async ({ detection, drawnRectangles }: { detection: Detection; drawnRectangles: DrawnRectangle[] }) => {
      const existingAnnotation = detectionAnnotations.get(detection.id);

      if (existingAnnotation) {
        // Convert drawn rectangles to annotation format
        const annotationItems = drawnRectangles.map(rect => ({
          xyxyn: rect.xyxyn,
          class_name: "smoke",
          smoke_type: "wildfire" as const
        }));

        // Update existing annotation with proper annotation data and 'annotated' stage
        return apiClient.updateDetectionAnnotation(existingAnnotation.id, {
          annotation: {
            annotation: annotationItems
          },
          processing_stage: 'annotated',
        });
      } else {
        // No annotation exists - this shouldn't happen if sequence annotation was submitted first
        // But in case it does, throw an error to guide the user
        throw new Error(`No detection annotation found for detection ${detection.id}. Please ensure the sequence annotation has been submitted first to auto-create detection annotations.`);
      }
    },
    onSuccess: (result, { detection }) => {
      // Update local state
      setDetectionAnnotations(prev => new Map(prev).set(detection.id, result));
      
      // Invalidate queries to refresh data
      queryClient.invalidateQueries({ queryKey: [...QUERY_KEYS.DETECTION_ANNOTATIONS] });
      // Invalidate annotation counts to update sidebar badges
      queryClient.invalidateQueries({ queryKey: ['annotation-counts'] });
      
      setToastMessage(`Detection ${detection.id} annotated successfully`);
      setShowToast(true);
    },
    onError: (_, { detection }) => {
      setToastMessage(`Failed to annotate detection ${detection.id}`);
      setShowToast(true);
    },
  });

  const handleBack = () => {
    navigate('/detections/annotate');
  };

  const handleSave = () => {
    saveAnnotations.mutate();
  };

  // Navigation logic
  const getCurrentSequenceIndex = () => {
    if (!allSequences?.items || !sequenceIdNum) return -1;
    return allSequences.items.findIndex(seq => seq.id === sequenceIdNum);
  };

  const canNavigatePrevious = () => {
    const currentIndex = getCurrentSequenceIndex();
    return currentIndex > 0;
  };

  const canNavigateNext = () => {
    const currentIndex = getCurrentSequenceIndex();
    return currentIndex >= 0 && allSequences?.items && currentIndex < allSequences.items.length - 1;
  };

  const handlePreviousSequence = () => {
    const currentIndex = getCurrentSequenceIndex();
    if (currentIndex > 0 && allSequences?.items) {
      const prevSequence = allSequences.items[currentIndex - 1];
      navigate(`/detections/${prevSequence.id}/annotate`);
    }
  };

  const handleNextSequence = () => {
    const currentIndex = getCurrentSequenceIndex();
    if (currentIndex >= 0 && allSequences?.items && currentIndex < allSequences.items.length - 1) {
      const nextSequence = allSequences.items[currentIndex + 1];
      navigate(`/detections/${nextSequence.id}/annotate`);
    }
  };

  const openModal = (index: number) => {
    setSelectedDetectionIndex(index);
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedDetectionIndex(null);
  };

  const navigateModal = (direction: 'prev' | 'next') => {
    if (!detections || selectedDetectionIndex === null) return;

    const newIndex = direction === 'prev'
      ? Math.max(0, selectedDetectionIndex - 1)
      : Math.min(detections.length - 1, selectedDetectionIndex + 1);

    setSelectedDetectionIndex(newIndex);
  };

  // Keyboard event handlers
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Submit with Enter key
      if (e.key === 'Enter' && !showModal) {
        handleSave();
        e.preventDefault();
        return;
      }

      // Toggle predictions visibility with 'p' key (works globally, whether modal is open or not)
      if (e.key === 'p' || e.key === 'P') {
        setShowPredictions(!showPredictions);
        e.preventDefault();
        return;
      }

      // Modal navigation and submission
      if (showModal && selectedDetectionIndex !== null && detections) {
        if (e.key === 'Escape') {
          // Only close main modal if no child modals are handling the escape
          // The ImageModal will handle its own escape logic first
          closeModal();
          e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
          navigateModal('prev');
          e.preventDefault();
        } else if (e.key === 'ArrowRight') {
          navigateModal('next');
          e.preventDefault();
        } else if (e.key === ' ' && !annotateIndividualDetection.isPending) {
          // Space bar submission is handled by the ImageModal's own keyboard handler
          // which has access to the actual drawnRectangles state. This is just a fallback
          // that shouldn't normally execute since modal handles Space key first.
          e.preventDefault();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showModal, selectedDetectionIndex, detections, detectionAnnotations, annotateIndividualDetection, showPredictions]);

  // Toast auto-dismiss
  useEffect(() => {
    if (showToast) {
      const timer = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [showToast]);

  // Calculate progress
  const annotatedCount = Array.from(detectionAnnotations.values()).filter(
    a => a.processing_stage === 'annotated'
  ).length;
  const totalCount = detections?.length || 0;
  const completionPercentage = totalCount > 0 ? Math.round((annotatedCount / totalCount) * 100) : 0;

  // Helper to get annotation pills
  const getAnnotationPills = () => {
    if (!sequenceAnnotation) return null;

    const pills = [];

    if (sequenceAnnotation.has_smoke) {
      pills.push(
        <span key="smoke" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
          Smoke
        </span>
      );
    }

    if (sequenceAnnotation.has_missed_smoke) {
      pills.push(
        <span key="missed" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
          Missed Smoke
        </span>
      );
    }

    if (sequenceAnnotation.has_false_positives) {
      // Add individual false positive type pills
      try {
        const falsePositiveTypes = sequenceAnnotation.false_positive_types
          ? JSON.parse(sequenceAnnotation.false_positive_types)
          : [];

        falsePositiveTypes.forEach((type: string) => {
          pills.push(
            <span
              key={`fp-${type}`}
              className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800"
            >
              {getFalsePositiveEmoji(type)} {formatFalsePositiveType(type)}
            </span>
          );
        });
      } catch (e) {
        // If JSON parsing fails, just show the generic false positive pill
        console.warn('Failed to parse false_positive_types:', e);
      }
    }

    if (!sequenceAnnotation.has_smoke && !sequenceAnnotation.has_missed_smoke && !sequenceAnnotation.has_false_positives) {
      pills.push(
        <span key="no-smoke" className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
          No Smoke
        </span>
      );
    }

    return pills;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        {/* Header skeleton */}
        <div className="flex items-center space-x-4">
          <div className="w-8 h-8 bg-gray-200 animate-pulse rounded"></div>
          <div className="h-8 w-64 bg-gray-200 animate-pulse rounded"></div>
        </div>

        {/* Grid skeleton */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="aspect-video bg-gray-200 animate-pulse rounded-lg"></div>
              <div className="h-4 bg-gray-200 animate-pulse rounded"></div>
              <div className="h-3 w-24 bg-gray-200 animate-pulse rounded"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <div className="text-center">
          <p className="text-red-600 mb-2">Failed to load detections</p>
          <p className="text-gray-500 text-sm">{String(error)}</p>
          <button
            onClick={handleBack}
            className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm transition-colors"
          >
            Go Back
          </button>
        </div>
      </div>
    );
  }

  if (!detections || detections.length === 0) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center space-x-4">
          <button
            onClick={handleBack}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Detection Annotations</h1>
            <p className="text-gray-600">Sequence {sequenceId}</p>
          </div>
        </div>

        {/* Empty state */}
        <div className="flex items-center justify-center min-h-96">
          <div className="text-center">
            <div className="text-4xl mb-4">🔍</div>
            <p className="text-lg font-medium mb-2">No detections found</p>
            <p className="text-gray-500">This sequence doesn't have any detections to annotate.</p>
            <button
              onClick={handleBack}
              className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm transition-colors"
            >
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isAllAnnotated = annotatedCount === totalCount;

  return (
    <>
      {/* Fixed Header */}
      <div className={`fixed top-0 left-0 md:left-64 right-0 backdrop-blur-sm shadow-sm z-30 ${isAllAnnotated
        ? 'bg-green-50/90 border-b border-green-200 border-l-4 border-l-green-500'
        : 'bg-white/85 border-b border-gray-200'
        }`}>
        <div className="px-10 py-3">
          {/* Top Row: Context + Action Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <button
                onClick={handleBack}
                className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75"
                title="Back to sequences"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-900">
                  {sequence?.organisation_name || 'Loading...'}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-sm text-gray-600">
                  {sequence?.camera_name || 'Loading...'}
                </span>
                <span className="text-gray-400">•</span>
                <span className="text-sm text-gray-600">
                  {sequence?.recorded_at ? new Date(sequence.recorded_at).toLocaleString() : 'Loading...'}
                </span>
                {sequence?.azimuth !== null && sequence?.azimuth !== undefined && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {sequence.azimuth}°
                    </span>
                  </>
                )}
                {sequence?.lat !== null && sequence?.lat !== undefined && sequence?.lon !== null && sequence?.lon !== undefined && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-gray-500">
                      {sequence.lat.toFixed(3)}, {sequence.lon.toFixed(3)}
                    </span>
                  </>
                )}

                {/* Sequence context */}
                {allSequences && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="text-xs text-blue-600 font-medium">
                      Sequence {getCurrentSequenceIndex() + 1} of {allSequences.total}
                    </span>
                  </>
                )}

                {/* Completion Badge */}
                {isAllAnnotated && (
                  <>
                    <span className="text-gray-400">•</span>
                    <span className="inline-flex items-center text-xs text-green-600 font-medium">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Completed
                    </span>
                  </>
                )}
              </div>
            </div>

            <div className="flex items-center space-x-2">
              {/* Navigation Buttons */}
              <button
                onClick={handlePreviousSequence}
                disabled={!canNavigatePrevious()}
                className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
                title={canNavigatePrevious() ? "Previous sequence" : "Already at first sequence"}
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handleNextSequence}
                disabled={!canNavigateNext()}
                className="p-1.5 rounded-md hover:bg-gray-100 hover:bg-opacity-75 disabled:opacity-40 disabled:cursor-not-allowed"
                title={canNavigateNext() ? "Next sequence" : "Already at last sequence"}
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {/* Predictions Toggle */}
              <label className="flex items-center space-x-2 px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showPredictions}
                  onChange={(e) => setShowPredictions(e.target.checked)}
                  className="w-3 h-3 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <span>Show predictions</span>
              </label>

              <button
                onClick={handleSave}
                disabled={saveAnnotations.isPending}
                className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md shadow-sm text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Submit annotations (Enter)"
              >
                {saveAnnotations.isPending ? (
                  <div className="w-3 h-3 mr-1 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                ) : (
                  <Upload className="w-3 h-3 mr-1" />
                )}
                Submit
              </button>
            </div>
          </div>

          {/* Bottom Row: Progress + Model Accuracy + Annotation Pills */}
          <div className="flex items-center justify-between mt-2">
            <div className="flex items-center space-x-4">
              <span className="text-xs font-medium text-gray-900">
                Review: {isAllAnnotated ? (
                  <span className="text-green-600">Done</span>
                ) : (
                  <span className="text-orange-600">Pending</span>
                )} • {annotatedCount} of {totalCount} detections • {completionPercentage}% complete
              </span>

              {/* Model Accuracy Context */}
              {sequence && sequenceAnnotation && (
                <div className="flex items-center space-x-2">
                  {(() => {
                    const accuracy = analyzeSequenceAccuracy({
                      ...sequence,
                      annotation: sequenceAnnotation
                    });
                    return (
                      <span className={getModelAccuracyBadgeClasses(accuracy, 'sm')}>
                        {accuracy.icon} {accuracy.label}
                      </span>
                    );
                  })()}
                </div>
              )}

              {/* Annotation pills */}
              <div className="flex items-center space-x-2">
                {getAnnotationPills()}
              </div>
            </div>

            <div className="flex items-center space-x-3">
              {isAllAnnotated ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <AlertCircle className="w-4 h-4 text-orange-500" />
              )}
              <div className="w-24 bg-gray-200 rounded-full h-1.5">
                <div
                  className={`h-1.5 rounded-full transition-all duration-300 ${isAllAnnotated ? 'bg-green-600' : 'bg-primary-600'
                    }`}
                  style={{ width: `${completionPercentage}%` }}
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content with top padding to account for fixed header */}
      <div className="space-y-6 pt-20">
        {/* Detection Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {detections.map((detection, index) => (
            <DetectionImageCard
              key={detection.id}
              detection={detection}
              onClick={() => openModal(index)}
              isAnnotated={detectionAnnotations.get(detection.id)?.processing_stage === 'annotated'}
              showPredictions={showPredictions}
            />
          ))}
        </div>
      </div>

      {/* Image Modal */}
      {showModal && selectedDetectionIndex !== null && detections[selectedDetectionIndex] && (
        <ImageModal
          detection={detections[selectedDetectionIndex]}
          onClose={closeModal}
          onNavigate={navigateModal}
          onSubmit={(detection, drawnRectangles) => annotateIndividualDetection.mutate({ detection, drawnRectangles })}
          onTogglePredictions={setShowPredictions}
          canNavigatePrev={selectedDetectionIndex > 0}
          canNavigateNext={selectedDetectionIndex < detections.length - 1}
          currentIndex={selectedDetectionIndex}
          totalCount={detections.length}
          showPredictions={showPredictions}
          isSubmitting={annotateIndividualDetection.isPending}
          isAnnotated={detectionAnnotations.get(detections[selectedDetectionIndex].id)?.processing_stage === 'annotated'}
          existingAnnotation={detectionAnnotations.get(detections[selectedDetectionIndex].id)}
        />
      )}

      {/* Toast Notification */}
      {showToast && (
        <div className={`fixed top-24 right-4 z-50 transition-all duration-300 ease-in-out transform ${showToast ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
          }`}>
          <div className="px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 min-w-80 bg-green-50 border border-green-200">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <span className="text-sm font-medium text-green-800">{toastMessage}</span>
          </div>
        </div>
      )}
    </>
  );
}
