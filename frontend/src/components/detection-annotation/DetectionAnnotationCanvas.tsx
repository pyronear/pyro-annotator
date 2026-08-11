/**
 * Canvas for the localize object editor: image display, zoom, pan, and the
 * one box this object has on this frame.
 *
 * An object has AT MOST ONE box per frame, so this renders exactly one
 * committed box — always draggable and resizable — plus the candidates that
 * are NOT committed, as read-only dimmed ghosts. The per-model-box review
 * vocabulary this component used to carry (reject / adjust / select over an
 * unbounded rectangle array) has nothing left to express: clearing the box
 * is "reject", editing it in place is "adjust". See
 * docs/specs/2026-08-05-localize-object-editor-revamp-design.md.
 */

import { Detection, SmokeType } from '@/types/api';
import { useDetectionImage } from '@/hooks/useDetectionImage';
import {
  CurrentDrawing,
  Point,
  ResizeHandle,
  DrawnRectangle,
  type BoxCandidate,
} from '@/utils/annotation';
import {
  DrawingOverlay,
  SiblingBoundingBoxOverlay,
  ObjectIdentityOverlay,
  type ObjectOverlayItem,
} from '@/components/annotation/ImageOverlays';
import { SOURCE_COLOR, SOURCE_WEIGHT } from '@/components/localize/editor/sourceIdentity';
import { hairlineStroke } from '@/utils/annotation/hairlineStroke';

interface ImageInfo {
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

/** The committed box's id inside `DrawingOverlay`. */
const COMMITTED_ID = 'committed';

interface DetectionAnnotationCanvasProps {
  detection: Detection;
  /** The single committed box, or null on a frame with none. */
  committed: BoxCandidate | null;
  /** Candidates that are NOT committed, drawn dimmed. */
  ghosts: BoxCandidate[];
  showGhosts: boolean;
  /** Whether the committed box is selected — only then does it show handles. */
  selected: boolean;
  selectedSmokeType: SmokeType;
  showSiblingBboxes?: boolean;
  // Collocated localize context: the OTHER contributing objects' boxes on
  // this same frame, color-coded and labeled with their own object
  // identity. When provided (even an empty array) it replaces the generic
  // `SiblingBoundingBoxOverlay` layer.
  objectOverlays?: ObjectOverlayItem[];
  /** A box is being dragged out right now; its handles must not eat the drag. */
  isDrawMode: boolean;
  onBoxPointerDown: (e: React.MouseEvent) => void;
  onHandlePointerDown: (handle: ResizeHandle, e: React.MouseEvent) => void;
  currentDrawing: CurrentDrawing | null;
  // Image and container refs passed from parent
  containerRef: React.RefObject<HTMLDivElement>;
  imgRef: React.RefObject<HTMLImageElement>;
  imageInfo: ImageInfo | null;
  // Zoom/pan state passed from parent
  zoomLevel: number;
  panOffset: Point;
  transformOrigin: Point;
  isDragging: boolean;
  // Event handlers
  onMouseDown: (e: React.MouseEvent) => void;
  onMouseMove: (e: React.MouseEvent) => void;
  onMouseUp: (e: React.MouseEvent) => void;
  onClick: (e: React.MouseEvent) => void;
  getCursorStyle: () => string;
  handleImageLoad: () => void;
  normalizedToImage: (normalizedX: number, normalizedY: number) => Point;
  overlaysVisible: boolean;
}

export function DetectionAnnotationCanvas({
  detection,
  committed,
  ghosts,
  showGhosts,
  selected,
  selectedSmokeType,
  showSiblingBboxes = true,
  objectOverlays,
  isDrawMode,
  onBoxPointerDown,
  onHandlePointerDown,
  currentDrawing,
  containerRef,
  imgRef,
  imageInfo,
  zoomLevel,
  panOffset,
  transformOrigin,
  isDragging,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onClick,
  getCursorStyle,
  handleImageLoad,
  normalizedToImage,
  overlaysVisible,
}: DetectionAnnotationCanvasProps) {
  const { data: imageData } = useDetectionImage(detection.id);

  // `DrawingOverlay` speaks in rectangle arrays; the committed box is a
  // one-element array. Selecting it is what reveals its move/resize
  // affordances — unselected it renders in its own smoke-type color, so the
  // box always shows its identity rather than a permanent "selected" yellow.
  // Drawing suppresses the handles so a click-to-draw isn't swallowed by the
  // box underneath.
  const drawnRectangles: DrawnRectangle[] = committed
    ? [{ id: COMMITTED_ID, xyxyn: committed.xyxyn, smokeType: selectedSmokeType }]
    : [];

  const ghostBox = (ghost: BoxCandidate) => {
    if (!imageInfo) return null;
    const topLeft = normalizedToImage(ghost.xyxyn[0], ghost.xyxyn[1]);
    const bottomRight = normalizedToImage(ghost.xyxyn[2], ghost.xyxyn[3]);
    return {
      left: imageInfo.offsetX + topLeft.x,
      top: imageInfo.offsetY + topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  };

  return imageData?.url ? (
    <div
      ref={containerRef}
      className="relative overflow-hidden"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
      onClick={onClick}
      style={{ cursor: getCursorStyle() }}
    >
      <img
        ref={imgRef}
        src={imageData.url}
        alt={`Detection ${detection.id}`}
        className="max-w-full max-h-[95vh] object-contain block"
        style={{
          transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
          transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out',
        }}
        onLoad={handleImageLoad}
      />

      {/* Other objects on this same frame — identity-labeled when the page
          supplies them, the generic sibling layer otherwise. */}
      <div
        className="absolute inset-0 pointer-events-none z-10 transition-opacity duration-300 ease-in-out"
        style={{
          transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
          transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
          transition: isDragging ? 'none' : 'transform 0.1s ease-out, opacity 0.3s ease-in-out',
          opacity: imageInfo && overlaysVisible ? 1 : 0,
        }}
      >
        {objectOverlays === undefined && showSiblingBboxes && imageInfo && (
          <SiblingBoundingBoxOverlay detection={detection} imageInfo={imageInfo} />
        )}
        {objectOverlays !== undefined && imageInfo && (
          <ObjectIdentityOverlay
            objects={objectOverlays}
            imageInfo={imageInfo}
            strokeScale={zoomLevel}
          />
        )}
      </div>

      {/* Ghosts: the candidates this frame offers that are NOT committed.
          Read-only — committing one is the rail's job, so they never take
          pointer events away from drawing or from the committed box.
          Unlabeled: the rail beside the image is a permanent legend naming
          every source next to its swatch, and colour and stroke weight
          already say which is which. Other OBJECTS' boxes do
          keep their labels — nothing else on screen names them. */}
      {showGhosts && imageInfo && (
        <div
          className="absolute inset-0 pointer-events-none z-20"
          style={{
            transform: `scale(${zoomLevel}) translate(${panOffset.x}px, ${panOffset.y}px)`,
            transformOrigin: `${transformOrigin.x}% ${transformOrigin.y}%`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
            opacity: overlaysVisible ? 1 : 0,
          }}
        >
          {ghosts.map(ghost => {
            const box = ghostBox(ghost);
            if (!box) return null;
            return (
              <div
                key={`${ghost.source}-${ghost.index}`}
                data-testid={`ghost-box-${ghost.source}-${ghost.index}`}
                className="absolute opacity-90"
                style={{
                  // Divided by the zoom so the stroke keeps its on-screen
                  // weight however far the image is scaled — and painted
                  // rather than laid out, so that division is not clamped
                  // away. See `hairlineStroke`.
                  ...hairlineStroke({
                    color: SOURCE_COLOR[ghost.source],
                    width: SOURCE_WEIGHT[ghost.source],
                    scale: zoomLevel,
                  }),
                  left: `${box.left}px`,
                  top: `${box.top}px`,
                  width: `${box.width}px`,
                  height: `${box.height}px`,
                }}
              />
            );
          })}
        </div>
      )}

      {/* The committed box, plus any in-progress drawing. */}
      <div
        className="absolute inset-0 z-30 transition-opacity duration-300 ease-in-out"
        style={{ opacity: imageInfo && overlaysVisible ? 1 : 0 }}
        data-testid={committed ? 'committed-box' : undefined}
      >
        {imageInfo && (
          <DrawingOverlay
            drawnRectangles={drawnRectangles}
            currentDrawing={currentDrawing}
            selectedRectangleId={selected ? COMMITTED_ID : null}
            imageInfo={imageInfo}
            zoomLevel={zoomLevel}
            panOffset={panOffset}
            transformOrigin={transformOrigin}
            isDragging={isDragging}
            normalizedToImage={normalizedToImage}
            boxColor={committed ? SOURCE_COLOR[committed.source] : undefined}
            boxWidth={committed ? SOURCE_WEIGHT[committed.source] : undefined}
            strokeScale={zoomLevel}
            onBoxPointerDown={(_id, e) => onBoxPointerDown(e)}
            onHandlePointerDown={
              isDrawMode ? undefined : (_id, handle, e) => onHandlePointerDown(handle, e)
            }
          />
        )}
      </div>
    </div>
  ) : (
    <div className="flex h-96 w-96 items-center justify-center rounded-card border border-line bg-ash">
      <span className="font-body text-sm text-haze">No image available</span>
    </div>
  );
}
