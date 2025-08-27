/**
 * Canvas component for detection annotation.
 * Handles image display, drawing interactions, zoom, and pan.
 */

import { useState, useRef, useEffect } from 'react';
import { Detection, DetectionAnnotation, SmokeType } from '@/types/api';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import { 
  DrawnRectangle, 
  CurrentDrawing, 
  Point, 
  ImageBounds,
  calculateImageBounds,
  screenToImageCoordinates,
  imageToNormalizedCoordinates,
  getRectangleAtPoint,
  createDrawnRectangle,
  calculateZoomLevel,
  calculateTransformOrigin,
  calculatePanConstraints,
  constrainPan,
  calculateSizeThreshold,
  getMouseRelativeToElement,
  isValidDrawingSize
} from '@/utils/annotation';
import { BoundingBoxOverlay, UserAnnotationOverlay, DrawingOverlay } from '@/components/annotation/ImageOverlays';

interface DetectionAnnotationCanvasProps {
  detection: Detection;
  drawnRectangles: DrawnRectangle[];
  onRectanglesChange: (rectangles: DrawnRectangle[]) => void;
  selectedSmokeType: SmokeType;
  isDrawMode: boolean;
  showPredictions: boolean;
  existingAnnotation?: DetectionAnnotation | null;
  currentDrawing: CurrentDrawing | null;
  onCurrentDrawingChange: (drawing: CurrentDrawing | null) => void;
  isActivelyDrawing: boolean;
  onActivelyDrawingChange: (drawing: boolean) => void;
  selectedRectangleId: string | null;
  onSelectedRectangleIdChange: (id: string | null) => void;
  onPushUndoState: () => void;
}

interface ImageInfo {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export function DetectionAnnotationCanvas({
  detection,
  drawnRectangles,
  onRectanglesChange,
  selectedSmokeType,
  isDrawMode,
  showPredictions,
  existingAnnotation,
  currentDrawing,
  onCurrentDrawingChange,
  isActivelyDrawing,
  onActivelyDrawingChange,
  selectedRectangleId,
  onSelectedRectangleIdChange,
  onPushUndoState
}: DetectionAnnotationCanvasProps) {
  const { data: imageData } = useDetectionImage(detection.id);
  const [imageInfo, setImageInfo] = useState<ImageInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  
  // Zoom and pan state
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [transformOrigin, setTransformOrigin] = useState({ x: 50, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Handle image load to get dimensions
  const handleImageLoad = () => {
    if (imgRef.current && containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const imgRect = imgRef.current.getBoundingClientRect();

      const offsetX = imgRect.left - containerRect.left;
      const offsetY = imgRect.top - containerRect.top;
      const width = imgRect.width;
      const height = imgRect.height;

      setImageInfo({ width, height, offsetX, offsetY });
    }
  };

  // Reset zoom and pan when detection changes
  useEffect(() => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
    setTransformOrigin({ x: 50, y: 50 });
    setImageInfo(null);
  }, [detection.id]);

  // Get image transformation info
  const getImageInfo = (): { containerOffset: Point; imageBounds: ImageBounds; transform: { zoomLevel: number; panOffset: Point; transformOrigin: Point } } | null => {
    if (!imgRef.current || !containerRef.current) return null;
    
    const containerRect = containerRef.current.getBoundingClientRect();
    const img = imgRef.current;
    
    const containerOffset: Point = {
      x: containerRect.left,
      y: containerRect.top
    };

    const imageBounds = calculateImageBounds({
      containerWidth: containerRef.current.offsetWidth,
      containerHeight: containerRef.current.offsetHeight,
      imageNaturalWidth: img.naturalWidth,
      imageNaturalHeight: img.naturalHeight
    });

    const transform = {
      zoomLevel,
      panOffset,
      transformOrigin
    };

    return { containerOffset, imageBounds, transform };
  };
  
  // Coordinate conversion wrappers
  const screenToImageCoords = (screenX: number, screenY: number) => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };
    
    return screenToImageCoordinates(
      { x: screenX, y: screenY },
      info.containerOffset,
      info.imageBounds,
      info.transform
    );
  };

  const imageToNormalized = (imageX: number, imageY: number) => {
    const info = getImageInfo();
    if (!info) return { x: 0, y: 0 };
    
    return imageToNormalizedCoordinates(
      { x: imageX, y: imageY },
      info.imageBounds
    );
  };

  const getRectAtPoint = (x: number, y: number): DrawnRectangle | null => {
    const info = getImageInfo();
    if (!info) return null;
    
    return getRectangleAtPoint(
      { x, y },
      drawnRectangles,
      info.imageBounds
    );
  };

  // Mouse event handlers
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    
    const coords = screenToImageCoords(e.clientX, e.clientY);
    const hitRectangle = getRectAtPoint(coords.x, coords.y);
    
    if (hitRectangle) {
      onSelectedRectangleIdChange(hitRectangle.id);
      onActivelyDrawingChange(false);
      onCurrentDrawingChange(null);
      return;
    }
    
    onSelectedRectangleIdChange(null);
    
    if (!isDrawMode) return;
    
    if (!isActivelyDrawing) {
      // Start drawing
      onCurrentDrawingChange({
        startX: coords.x,
        startY: coords.y,
        currentX: coords.x,
        currentY: coords.y
      });
      onActivelyDrawingChange(true);
    } else {
      // Finish drawing
      if (currentDrawing) {
        const startNorm = imageToNormalized(currentDrawing.startX, currentDrawing.startY);
        const endNorm = imageToNormalized(coords.x, coords.y);
        
        // Check minimum size
        const sizeThreshold = calculateSizeThreshold(imgRef.current?.getBoundingClientRect().width || 1000);
        if (isValidDrawingSize(startNorm.x, startNorm.y, endNorm.x, endNorm.y, sizeThreshold)) {
          onPushUndoState();
          
          const newRect = createDrawnRectangle(
            currentDrawing,
            getImageInfo()?.imageBounds || { width: 1, height: 1, x: 0, y: 0 },
            selectedSmokeType
          );
          
          onRectanglesChange([...drawnRectangles, newRect]);
        }
      }
      
      onCurrentDrawingChange(null);
      onActivelyDrawingChange(false);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isActivelyDrawing && currentDrawing) {
      const coords = screenToImageCoords(e.clientX, e.clientY);
      onCurrentDrawingChange({ 
        ...currentDrawing, 
        currentX: coords.x, 
        currentY: coords.y 
      });
    } else if (isDragging && !isDrawMode && zoomLevel > 1.0) {
      const newX = e.clientX - dragStart.x;
      const newY = e.clientY - dragStart.y;
      
      if (imgRef.current) {
        const imgRect = imgRef.current.getBoundingClientRect();
        const constraints = calculatePanConstraints(
          zoomLevel,
          imgRect.width,
          imgRect.height,
          imgRect.width,
          imgRect.height
        );
        const constrainedOffset = constrainPan({ x: newX, y: newY }, constraints);
        setPanOffset(constrainedOffset);
      }
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isDrawMode && zoomLevel > 1.0) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - panOffset.x, y: e.clientY - panOffset.y });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // Zoom handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    
    if (!containerRef.current || !imgRef.current) return;
    
    const imgRect = imgRef.current.getBoundingClientRect();
    const mousePos = getMouseRelativeToElement(e.clientX, e.clientY, imgRect);
    const origin = calculateTransformOrigin(mousePos.x, mousePos.y, imgRect.width, imgRect.height);
    
    setTransformOrigin(origin);
    
    const newZoom = calculateZoomLevel(zoomLevel, e.deltaY, { 
      minZoom: 1.0, 
      maxZoom: 5.0, 
      zoomStep: 0.1 
    });
    setZoomLevel(newZoom);
    
    if (newZoom <= 1.0) {
      setPanOffset({ x: 0, y: 0 });
      setTransformOrigin({ x: 50, y: 50 });
    }
  };

  const handleZoomReset = () => {
    setZoomLevel(1.0);
    setPanOffset({ x: 0, y: 0 });
    setTransformOrigin({ x: 50, y: 50 });
  };

  if (!imageData?.url) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-gray-100">
        <span className="text-gray-500">No image available</span>
      </div>
    );
  }

  return (
    <div 
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-gray-100 cursor-crosshair"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onWheel={handleWheel}
    >
      <img
        ref={imgRef}
        src={imageData.url}
        alt={`Detection ${detection.id}`}
        className="w-full h-full object-contain transition-transform duration-200"
        style={{
          transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
          transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`
        }}
        onLoad={handleImageLoad}
        draggable={false}
      />
      
      {/* AI Predictions Overlay */}
      {showPredictions && detection.algo_predictions?.predictions && imageInfo && (
        <BoundingBoxOverlay
          detection={detection}
          imageInfo={imageInfo}
        />
      )}

      {/* User Annotations Overlay */}
      {existingAnnotation?.annotation?.annotation && imageInfo && (
        <UserAnnotationOverlay
          detectionAnnotation={existingAnnotation}
          imageInfo={imageInfo}
        />
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
          isDragging={isDragging}
          normalizedToImage={(normX: number, normY: number) => {
            const info = getImageInfo();
            if (!info) return { x: 0, y: 0 };
            return {
              x: normX * info.imageBounds.width,
              y: normY * info.imageBounds.height
            };
          }}
        />
      )}

      {/* Zoom Controls */}
      {zoomLevel > 1.0 && (
        <div className="absolute bottom-4 right-4 bg-black bg-opacity-75 text-white px-3 py-2 rounded-lg text-sm">
          <div className="flex items-center space-x-2">
            <span>{Math.round(zoomLevel * 100)}%</span>
            <button
              onClick={handleZoomReset}
              className="bg-white bg-opacity-20 hover:bg-opacity-30 px-2 py-1 rounded text-xs"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}