/**
 * Unit tests for drawing utilities.
 * These tests verify drawing operations like rectangle creation, validation, and transformations.
 */

import { describe, it, expect } from 'vitest';
import {
  getSmokeTypeColors,
  createDrawnRectangle,
  validateDrawingSize,
  isPointInRectangle,
  getRectangleAtPoint,
  updateRectangleSmokeType,
  removeRectangle,
  importPredictionsAsRectangles,
  areBoundingBoxesSimilar,
  calculateDrawingStats,
  DrawnRectangle,
  CurrentDrawing,
  SmokeTypeColors
} from '@/utils/annotation/drawingUtils';
import { Point, ImageBounds } from '@/utils/annotation/coordinateUtils';
import { SmokeType } from '@/types/api';

describe('drawingUtils', () => {
  describe('getSmokeTypeColors', () => {
    it('should return correct colors for wildfire', () => {
      const colors = getSmokeTypeColors('wildfire');
      expect(colors.border).toBe('border-red-500');
      expect(colors.background).toBe('bg-red-500/15');
    });

    it('should return correct colors for industrial', () => {
      const colors = getSmokeTypeColors('industrial');
      expect(colors.border).toBe('border-purple-500');
      expect(colors.background).toBe('bg-purple-500/15');
    });

    it('should return correct colors for other', () => {
      const colors = getSmokeTypeColors('other');
      expect(colors.border).toBe('border-blue-500');
      expect(colors.background).toBe('bg-blue-500/15');
    });
  });

  describe('createDrawnRectangle', () => {
    const imageBounds: ImageBounds = {
      width: 800,
      height: 600,
      x: 0,
      y: 0
    };

    it('should create a rectangle from current drawing', () => {
      const currentDrawing: CurrentDrawing = {
        startX: 100,
        startY: 150,
        currentX: 300,
        currentY: 350
      };

      const rectangle = createDrawnRectangle(currentDrawing, imageBounds, 'wildfire');

      expect(rectangle.id).toBeDefined();
      expect(rectangle.id).toMatch(/^\d+$/); // Should be timestamp string
      expect(rectangle.smokeType).toBe('wildfire');
      expect(rectangle.xyxyn).toHaveLength(4);
      
      // Check normalized coordinates
      const [x1, y1, x2, y2] = rectangle.xyxyn;
      expect(x1).toBe(0.125); // 100/800
      expect(y1).toBe(0.25);  // 150/600
      expect(x2).toBe(0.375); // 300/800
      expect(y2).toBeCloseTo(0.583333333, 8); // 350/600 (approximately)
    });

    it('should handle reversed coordinates (bottom-right to top-left drawing)', () => {
      const currentDrawing: CurrentDrawing = {
        startX: 300,
        startY: 350,
        currentX: 100,
        currentY: 150
      };

      const rectangle = createDrawnRectangle(currentDrawing, imageBounds, 'industrial');

      const [x1, y1, x2, y2] = rectangle.xyxyn;
      expect(x1).toBe(0.125); // min(100, 300) / 800
      expect(y1).toBe(0.25);  // min(150, 350) / 600
      expect(x2).toBe(0.375); // max(100, 300) / 800
      expect(y2).toBeCloseTo(0.583, 3); // max(150, 350) / 600
    });

    it('should handle drawing at image boundaries', () => {
      const currentDrawing: CurrentDrawing = {
        startX: 0,
        startY: 0,
        currentX: 800,
        currentY: 600
      };

      const rectangle = createDrawnRectangle(currentDrawing, imageBounds, 'other');

      const [x1, y1, x2, y2] = rectangle.xyxyn;
      expect(x1).toBe(0);
      expect(y1).toBe(0);
      expect(x2).toBe(1);
      expect(y2).toBe(1);
    });
  });

  describe('validateDrawingSize', () => {
    it('should validate drawing size meets minimum requirements', () => {
      const largeDrawing: CurrentDrawing = {
        startX: 100,
        startY: 100,
        currentX: 150,
        currentY: 150
      };

      expect(validateDrawingSize(largeDrawing, 20)).toBe(true);
    });

    it('should reject drawing below minimum size', () => {
      const smallDrawing: CurrentDrawing = {
        startX: 100,
        startY: 100,
        currentX: 105,
        currentY: 105
      };

      expect(validateDrawingSize(smallDrawing, 20)).toBe(false);
    });

    it('should handle reversed coordinates when validating', () => {
      const reversedDrawing: CurrentDrawing = {
        startX: 150,
        startY: 150,
        currentX: 100,
        currentY: 100
      };

      expect(validateDrawingSize(reversedDrawing, 20)).toBe(true);
    });

    it('should handle zero minimum size', () => {
      const tinyDrawing: CurrentDrawing = {
        startX: 100,
        startY: 100,
        currentX: 101,
        currentY: 101
      };

      expect(validateDrawingSize(tinyDrawing, 0)).toBe(true);
    });
  });

  describe('isPointInRectangle', () => {
    const rectangle: DrawnRectangle = {
      id: 'test-rect',
      xyxyn: [0.25, 0.25, 0.75, 0.75], // 200-600, 150-450 in 800x600 image
      smokeType: 'wildfire'
    };

    const imageBounds: ImageBounds = {
      width: 800,
      height: 600,
      x: 0,
      y: 0
    };

    it('should detect point inside rectangle', () => {
      const point: Point = { x: 400, y: 300 }; // Center of rectangle
      expect(isPointInRectangle(point, rectangle, imageBounds)).toBe(true);
    });

    it('should detect point outside rectangle', () => {
      const point: Point = { x: 100, y: 100 }; // Outside rectangle
      expect(isPointInRectangle(point, rectangle, imageBounds)).toBe(false);
    });

    it('should handle point on rectangle border', () => {
      const point: Point = { x: 200, y: 300 }; // On left border
      expect(isPointInRectangle(point, rectangle, imageBounds)).toBe(true);
    });

    it('should handle point at rectangle corner', () => {
      const point: Point = { x: 200, y: 150 }; // Top-left corner
      expect(isPointInRectangle(point, rectangle, imageBounds)).toBe(true);
    });
  });

  describe('getRectangleAtPoint', () => {
    const rectangles: DrawnRectangle[] = [
      {
        id: 'rect-1',
        xyxyn: [0.1, 0.1, 0.4, 0.4],
        smokeType: 'wildfire'
      },
      {
        id: 'rect-2',
        xyxyn: [0.6, 0.6, 0.9, 0.9],
        smokeType: 'industrial'
      },
      {
        id: 'rect-3',
        xyxyn: [0.3, 0.3, 0.7, 0.7], // Overlaps with both
        smokeType: 'other'
      }
    ];

    const imageBounds: ImageBounds = {
      width: 1000,
      height: 1000,
      x: 0,
      y: 0
    };

    it('should return rectangle at point', () => {
      const point: Point = { x: 250, y: 250 }; // In rect-1
      const found = getRectangleAtPoint(point, rectangles, imageBounds);
      expect(found?.id).toBe('rect-1');
    });

    it('should return topmost rectangle when multiple rectangles overlap', () => {
      const point: Point = { x: 500, y: 500 }; // In rect-3 (last in array, topmost)
      const found = getRectangleAtPoint(point, rectangles, imageBounds);
      expect(found?.id).toBe('rect-3');
    });

    it('should return null when no rectangle at point', () => {
      const point: Point = { x: 50, y: 50 }; // Outside all rectangles
      const found = getRectangleAtPoint(point, rectangles, imageBounds);
      expect(found).toBeNull();
    });

    it('should handle empty rectangle array', () => {
      const point: Point = { x: 500, y: 500 };
      const found = getRectangleAtPoint(point, [], imageBounds);
      expect(found).toBeNull();
    });
  });

  describe('updateRectangleSmokeType', () => {
    const rectangles: DrawnRectangle[] = [
      {
        id: 'rect-1',
        xyxyn: [0.1, 0.1, 0.4, 0.4],
        smokeType: 'wildfire'
      },
      {
        id: 'rect-2',
        xyxyn: [0.6, 0.6, 0.9, 0.9],
        smokeType: 'industrial'
      }
    ];

    it('should update smoke type for specified rectangle', () => {
      const updated = updateRectangleSmokeType(rectangles, 'rect-1', 'other');
      
      expect(updated).toHaveLength(2);
      expect(updated[0].id).toBe('rect-1');
      expect(updated[0].smokeType).toBe('other');
      expect(updated[1].smokeType).toBe('industrial'); // Unchanged
    });

    it('should not modify original array (immutable)', () => {
      const updated = updateRectangleSmokeType(rectangles, 'rect-1', 'other');
      
      expect(rectangles[0].smokeType).toBe('wildfire'); // Original unchanged
      expect(updated[0].smokeType).toBe('other'); // New array updated
    });

    it('should return unchanged array when rectangle ID not found', () => {
      const updated = updateRectangleSmokeType(rectangles, 'nonexistent', 'other');
      
      expect(updated).toEqual(rectangles);
      expect(updated).not.toBe(rectangles); // Still a new array
    });

    it('should handle empty array', () => {
      const updated = updateRectangleSmokeType([], 'rect-1', 'other');
      expect(updated).toEqual([]);
    });
  });

  describe('removeRectangle', () => {
    const rectangles: DrawnRectangle[] = [
      {
        id: 'rect-1',
        xyxyn: [0.1, 0.1, 0.4, 0.4],
        smokeType: 'wildfire'
      },
      {
        id: 'rect-2',
        xyxyn: [0.6, 0.6, 0.9, 0.9],
        smokeType: 'industrial'
      },
      {
        id: 'rect-3',
        xyxyn: [0.3, 0.3, 0.7, 0.7],
        smokeType: 'other'
      }
    ];

    it('should remove specified rectangle', () => {
      const updated = removeRectangle(rectangles, 'rect-2');
      
      expect(updated).toHaveLength(2);
      expect(updated[0].id).toBe('rect-1');
      expect(updated[1].id).toBe('rect-3');
      expect(updated.find(r => r.id === 'rect-2')).toBeUndefined();
    });

    it('should not modify original array (immutable)', () => {
      const updated = removeRectangle(rectangles, 'rect-2');
      
      expect(rectangles).toHaveLength(3); // Original unchanged
      expect(updated).toHaveLength(2); // New array modified
    });

    it('should return unchanged array when rectangle ID not found', () => {
      const updated = removeRectangle(rectangles, 'nonexistent');
      
      expect(updated).toHaveLength(3);
      expect(updated).not.toBe(rectangles); // Still a new array
    });

    it('should handle empty array', () => {
      const updated = removeRectangle([], 'rect-1');
      expect(updated).toEqual([]);
    });

    it('should handle removing last rectangle', () => {
      const singleRect = [rectangles[0]];
      const updated = removeRectangle(singleRect, 'rect-1');
      expect(updated).toEqual([]);
    });
  });

  describe('importPredictionsAsRectangles', () => {
    const predictions = [
      { xyxyn: [0.1, 0.2, 0.8, 0.9] as [number, number, number, number] },
      { xyxyn: [0.3, 0.1, 0.7, 0.5] as [number, number, number, number] }
    ];

    const existingRectangles: DrawnRectangle[] = [
      {
        id: 'existing-1',
        xyxyn: [0.0, 0.0, 0.2, 0.2],
        smokeType: 'wildfire'
      }
    ];

    it('should create rectangles from predictions with specified smoke type', () => {
      const imported = importPredictionsAsRectangles(predictions, 'industrial', []);
      
      expect(imported).toHaveLength(2);
      expect(imported[0].smokeType).toBe('industrial');
      expect(imported[1].smokeType).toBe('industrial');
      expect(imported[0].xyxyn).toEqual([0.1, 0.2, 0.8, 0.9]);
      expect(imported[1].xyxyn).toEqual([0.3, 0.1, 0.7, 0.5]);
    });

    it('should generate unique IDs for imported rectangles', () => {
      const imported = importPredictionsAsRectangles(predictions, 'wildfire', []);
      
      expect(imported[0].id).toBeDefined();
      expect(imported[1].id).toBeDefined();
      expect(imported[0].id).not.toBe(imported[1].id);
      expect(imported[0].id).toMatch(/^imported-\d+-\d+$/);
    });

    it('should avoid creating rectangles similar to existing ones', () => {
      // Create prediction very similar to existing rectangle (within default 0.05 threshold)
      const similarPredictions = [
        { xyxyn: [0.01, 0.01, 0.21, 0.21] as [number, number, number, number] }, // Similar to existing [0.0, 0.0, 0.2, 0.2]
        { xyxyn: [0.5, 0.5, 0.9, 0.9] as [number, number, number, number] }    // Different
      ];

      const imported = importPredictionsAsRectangles(similarPredictions, 'other', existingRectangles);
      
      // Should only import the non-similar one
      expect(imported).toHaveLength(1);
      expect(imported[0].xyxyn).toEqual([0.5, 0.5, 0.9, 0.9]);
    });

    it('should handle empty predictions array', () => {
      const imported = importPredictionsAsRectangles([], 'wildfire', []);
      expect(imported).toEqual([]);
    });
  });

  describe('areBoundingBoxesSimilar', () => {
    it('should detect similar bounding boxes', () => {
      const bbox1: [number, number, number, number] = [0.1, 0.2, 0.8, 0.9];
      const bbox2: [number, number, number, number] = [0.12, 0.22, 0.82, 0.92];
      
      expect(areBoundingBoxesSimilar(bbox1, bbox2, 0.1)).toBe(true);
    });

    it('should detect dissimilar bounding boxes', () => {
      const bbox1: [number, number, number, number] = [0.1, 0.2, 0.8, 0.9];
      const bbox2: [number, number, number, number] = [0.3, 0.4, 0.9, 1.0];
      
      expect(areBoundingBoxesSimilar(bbox1, bbox2, 0.1)).toBe(false);
    });

    it('should handle identical bounding boxes', () => {
      const bbox1: [number, number, number, number] = [0.1, 0.2, 0.8, 0.9];
      const bbox2: [number, number, number, number] = [0.1, 0.2, 0.8, 0.9];
      
      expect(areBoundingBoxesSimilar(bbox1, bbox2, 0.05)).toBe(true);
    });

    it('should respect threshold parameter', () => {
      const bbox1: [number, number, number, number] = [0.1, 0.2, 0.8, 0.9];
      const bbox2: [number, number, number, number] = [0.15, 0.25, 0.85, 0.95];
      
      expect(areBoundingBoxesSimilar(bbox1, bbox2, 0.01)).toBe(false);
      expect(areBoundingBoxesSimilar(bbox1, bbox2, 0.1)).toBe(true);
    });
  });

  describe('calculateDrawingStats', () => {
    const rectangles: DrawnRectangle[] = [
      {
        id: 'rect-1',
        xyxyn: [0.0, 0.0, 0.5, 0.5], // Area: 0.25
        smokeType: 'wildfire'
      },
      {
        id: 'rect-2',
        xyxyn: [0.5, 0.5, 1.0, 1.0], // Area: 0.25
        smokeType: 'wildfire'
      },
      {
        id: 'rect-3',
        xyxyn: [0.2, 0.2, 0.4, 0.6], // Area: 0.08
        smokeType: 'industrial'
      }
    ];

    it('should calculate correct drawing statistics', () => {
      const stats = calculateDrawingStats(rectangles);
      
      expect(stats.total).toBe(3);
      expect(stats.wildfire).toBe(2);
      expect(stats.industrial).toBe(1);
      expect(stats.other).toBe(0);
    });

    it('should handle empty rectangles array', () => {
      const stats = calculateDrawingStats([]);
      
      expect(stats.total).toBe(0);
      expect(stats.wildfire).toBe(0);
      expect(stats.industrial).toBe(0);
      expect(stats.other).toBe(0);
    });

    it('should handle single rectangle', () => {
      const singleRect = [rectangles[0]];
      const stats = calculateDrawingStats(singleRect);
      
      expect(stats.total).toBe(1);
      expect(stats.wildfire).toBe(1);
      expect(stats.industrial).toBe(0);
      expect(stats.other).toBe(0);
    });
  });
});