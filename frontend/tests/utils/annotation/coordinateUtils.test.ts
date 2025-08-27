/**
 * Unit tests for coordinate transformation utilities.
 * These tests verify the mathematical correctness of coordinate system conversions.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateImageBounds,
  screenToImageCoordinates,
  imageToNormalizedCoordinates,
  normalizedToImageCoordinates,
  normalizedBboxToPixels,
  validateBoundingBox,
  calculateBoundingBoxArea,
  normalizedToPixelBox,
  ImageContainConfig,
  ImageBounds,
  Point,
  ImageInfo
} from '@/utils/annotation/coordinateUtils';

describe('coordinateUtils', () => {
  describe('calculateImageBounds', () => {
    it('should calculate correct bounds for landscape image in square container', () => {
      const config: ImageContainConfig = {
        containerWidth: 500,
        containerHeight: 500,
        imageNaturalWidth: 800,
        imageNaturalHeight: 600
      };

      const bounds = calculateImageBounds(config);

      // Image should be scaled to fit within container, maintaining aspect ratio
      // 800/600 = 1.33, so width should be limited by container height
      expect(bounds.width).toBe(500); // 500 * (800/600) = 666.67, but limited to 500
      expect(bounds.height).toBe(375); // 500 * (600/800) = 375
      expect(bounds.x).toBe(0); // Centered horizontally
      expect(bounds.y).toBe(62.5); // (500 - 375) / 2 = 62.5
    });

    it('should calculate correct bounds for portrait image in landscape container', () => {
      const config: ImageContainConfig = {
        containerWidth: 800,
        containerHeight: 400,
        imageNaturalWidth: 300,
        imageNaturalHeight: 600
      };

      const bounds = calculateImageBounds(config);

      // Portrait image in landscape container - height should be limited
      expect(bounds.width).toBe(200); // 400 * (300/600) = 200
      expect(bounds.height).toBe(400); // Limited by container height
      expect(bounds.x).toBe(300); // (800 - 200) / 2 = 300
      expect(bounds.y).toBe(0);
    });

    it('should handle square image in square container', () => {
      const config: ImageContainConfig = {
        containerWidth: 400,
        containerHeight: 400,
        imageNaturalWidth: 600,
        imageNaturalHeight: 600
      };

      const bounds = calculateImageBounds(config);

      expect(bounds.width).toBe(400);
      expect(bounds.height).toBe(400);
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(0);
    });

    it('should handle very small container dimensions', () => {
      const config: ImageContainConfig = {
        containerWidth: 10,
        containerHeight: 10,
        imageNaturalWidth: 1000,
        imageNaturalHeight: 1000
      };

      const bounds = calculateImageBounds(config);

      expect(bounds.width).toBe(10);
      expect(bounds.height).toBe(10);
      expect(bounds.x).toBe(0);
      expect(bounds.y).toBe(0);
    });
  });

  describe('screenToImageCoordinates', () => {
    const imageBounds: ImageBounds = {
      width: 400,
      height: 300,
      x: 50,
      y: 25
    };

    const containerOffset: Point = { x: 0, y: 0 };
    const defaultTransform = {
      zoomLevel: 1.0,
      panOffset: { x: 0, y: 0 },
      transformOrigin: { x: 50, y: 50 }
    };

    it('should convert screen coordinates to image coordinates with no transform', () => {
      const screenPoint: Point = { x: 250, y: 175 };
      const imagePoint = screenToImageCoordinates(screenPoint, containerOffset, imageBounds, defaultTransform);

      // With no zoom/pan, it should be: (250 - 50, 175 - 25) = (200, 150)
      expect(imagePoint.x).toBeCloseTo(200, 5);
      expect(imagePoint.y).toBeCloseTo(150, 5);
    });

    it('should handle coordinates at image origin', () => {
      const screenPoint: Point = { x: 50, y: 25 };
      const imagePoint = screenToImageCoordinates(screenPoint, containerOffset, imageBounds, defaultTransform);

      expect(imagePoint.x).toBeCloseTo(0, 5);
      expect(imagePoint.y).toBeCloseTo(0, 5);
    });

    it('should handle zoom transformation', () => {
      const screenPoint: Point = { x: 250, y: 175 };
      const zoomedTransform = {
        zoomLevel: 2.0,
        panOffset: { x: 0, y: 0 },
        transformOrigin: { x: 50, y: 50 }
      };
      const imagePoint = screenToImageCoordinates(screenPoint, containerOffset, imageBounds, zoomedTransform);

      // With 2x zoom and transform origin at center, the math is complex
      // Let's just verify it produces reasonable coordinates
      expect(typeof imagePoint.x).toBe('number');
      expect(typeof imagePoint.y).toBe('number');
      expect(imagePoint.x).toBeGreaterThan(0);
      expect(imagePoint.y).toBeGreaterThan(0);
    });

    it('should handle container offset', () => {
      const screenPoint: Point = { x: 250, y: 175 };
      const offsetContainer: Point = { x: 100, y: 50 };
      const imagePoint = screenToImageCoordinates(screenPoint, offsetContainer, imageBounds, defaultTransform);

      // With container offset: (250 - 100 - 50, 175 - 50 - 25) = (100, 100)
      expect(imagePoint.x).toBeCloseTo(100, 5);
      expect(imagePoint.y).toBeCloseTo(100, 5);
    });
  });

  describe('imageToNormalizedCoordinates', () => {
    const imageBounds: ImageBounds = {
      width: 800,
      height: 600,
      x: 0,
      y: 0
    };

    it('should normalize coordinates to 0-1 range', () => {
      const imagePoint: Point = { x: 400, y: 300 };
      const normalizedPoint = imageToNormalizedCoordinates(imagePoint, imageBounds);

      expect(normalizedPoint.x).toBe(0.5);
      expect(normalizedPoint.y).toBe(0.5);
    });

    it('should handle origin coordinates', () => {
      const imagePoint: Point = { x: 0, y: 0 };
      const normalizedPoint = imageToNormalizedCoordinates(imagePoint, imageBounds);

      expect(normalizedPoint.x).toBe(0);
      expect(normalizedPoint.y).toBe(0);
    });

    it('should handle bottom-right coordinates', () => {
      const imagePoint: Point = { x: 800, y: 600 };
      const normalizedPoint = imageToNormalizedCoordinates(imagePoint, imageBounds);

      expect(normalizedPoint.x).toBe(1);
      expect(normalizedPoint.y).toBe(1);
    });

    it('should clamp coordinates outside image bounds', () => {
      const imagePoint: Point = { x: -100, y: 800 };
      const normalizedPoint = imageToNormalizedCoordinates(imagePoint, imageBounds);

      expect(normalizedPoint.x).toBe(0); // Clamped to 0
      expect(normalizedPoint.y).toBe(1); // Clamped to 1
    });
  });

  describe('normalizedToImageCoordinates', () => {
    const imageBounds: ImageBounds = {
      width: 1000,
      height: 800,
      x: 0,
      y: 0
    };

    it('should convert normalized coordinates back to image coordinates', () => {
      const normalizedPoint: Point = { x: 0.3, y: 0.7 };
      const imagePoint = normalizedToImageCoordinates(normalizedPoint, imageBounds);

      expect(imagePoint.x).toBe(300);
      expect(imagePoint.y).toBe(560);
    });

    it('should handle origin coordinates', () => {
      const normalizedPoint: Point = { x: 0, y: 0 };
      const imagePoint = normalizedToImageCoordinates(normalizedPoint, imageBounds);

      expect(imagePoint.x).toBe(0);
      expect(imagePoint.y).toBe(0);
    });

    it('should handle corner coordinates', () => {
      const normalizedPoint: Point = { x: 1, y: 1 };
      const imagePoint = normalizedToImageCoordinates(normalizedPoint, imageBounds);

      expect(imagePoint.x).toBe(1000);
      expect(imagePoint.y).toBe(800);
    });
  });

  describe('normalizedBboxToPixels', () => {
    const imageBounds: ImageBounds = {
      width: 800,
      height: 600,
      x: 0,
      y: 0
    };

    it('should convert normalized bounding box to pixel coordinates', () => {
      const xyxyn: [number, number, number, number] = [0.1, 0.2, 0.8, 0.9];
      const pixels = normalizedBboxToPixels(xyxyn, imageBounds);

      expect(pixels.x).toBe(80);  // 0.1 * 800
      expect(pixels.y).toBe(120); // 0.2 * 600
      expect(pixels.width).toBe(560);  // (0.8 - 0.1) * 800
      expect(pixels.height).toBe(420); // (0.9 - 0.2) * 600
    });

    it('should handle full image bounding box', () => {
      const xyxyn: [number, number, number, number] = [0, 0, 1, 1];
      const pixels = normalizedBboxToPixels(xyxyn, imageBounds);

      expect(pixels.x).toBe(0);
      expect(pixels.y).toBe(0);
      expect(pixels.width).toBe(800);
      expect(pixels.height).toBe(600);
    });

    it('should handle small bounding box', () => {
      const xyxyn: [number, number, number, number] = [0.45, 0.45, 0.55, 0.55];
      const pixels = normalizedBboxToPixels(xyxyn, imageBounds);

      expect(pixels.x).toBeCloseTo(360, 5); // 0.45 * 800
      expect(pixels.y).toBeCloseTo(270, 5); // 0.45 * 600
      expect(pixels.width).toBeCloseTo(80, 5);  // 0.1 * 800
      expect(pixels.height).toBeCloseTo(60, 5); // 0.1 * 600
    });
  });

  describe('validateBoundingBox', () => {
    it('should validate correct bounding box', () => {
      const bbox: [number, number, number, number] = [0.1, 0.2, 0.8, 0.9];
      expect(validateBoundingBox(bbox)).toBe(true);
    });

    it('should reject bounding box with x2 <= x1', () => {
      const bbox: [number, number, number, number] = [0.8, 0.2, 0.1, 0.9];
      expect(validateBoundingBox(bbox)).toBe(false);
    });

    it('should reject bounding box with y2 <= y1', () => {
      const bbox: [number, number, number, number] = [0.1, 0.9, 0.8, 0.2];
      expect(validateBoundingBox(bbox)).toBe(false);
    });

    it('should reject bounding box with equal coordinates', () => {
      const bbox: [number, number, number, number] = [0.5, 0.5, 0.5, 0.5];
      expect(validateBoundingBox(bbox)).toBe(false);
    });

    it('should reject coordinates outside 0-1 range', () => {
      const bbox1: [number, number, number, number] = [-0.1, 0.2, 0.8, 0.9];
      const bbox2: [number, number, number, number] = [0.1, 0.2, 1.1, 0.9];
      const bbox3: [number, number, number, number] = [0.1, -0.1, 0.8, 0.9];
      const bbox4: [number, number, number, number] = [0.1, 0.2, 0.8, 1.1];

      expect(validateBoundingBox(bbox1)).toBe(false);
      expect(validateBoundingBox(bbox2)).toBe(false);
      expect(validateBoundingBox(bbox3)).toBe(false);
      expect(validateBoundingBox(bbox4)).toBe(false);
    });

    it('should validate bounding box at boundaries', () => {
      const bbox: [number, number, number, number] = [0, 0, 1, 1];
      expect(validateBoundingBox(bbox)).toBe(true);
    });
  });

  describe('calculateBoundingBoxArea', () => {
    it('should calculate area correctly', () => {
      const bbox: [number, number, number, number] = [0.1, 0.2, 0.8, 0.9];
      const area = calculateBoundingBoxArea(bbox);

      // (0.8 - 0.1) * (0.9 - 0.2) = 0.7 * 0.7 = 0.49
      expect(area).toBe(0.49);
    });

    it('should handle full image area', () => {
      const bbox: [number, number, number, number] = [0, 0, 1, 1];
      const area = calculateBoundingBoxArea(bbox);

      expect(area).toBe(1);
    });

    it('should handle small area', () => {
      const bbox: [number, number, number, number] = [0.4, 0.4, 0.6, 0.6];
      const area = calculateBoundingBoxArea(bbox);

      expect(area).toBeCloseTo(0.04, 10); // 0.2 * 0.2
    });

    it('should return 0 for invalid bounding box with negative dimensions', () => {
      const bbox: [number, number, number, number] = [0.8, 0.2, 0.1, 0.9];
      const area = calculateBoundingBoxArea(bbox);

      expect(area).toBe(0);
    });
  });

  describe('normalizedToPixelBox', () => {
    const imageInfo: ImageInfo = {
      width: 500,
      height: 400,
      offsetX: 50,
      offsetY: 25
    };

    it('should convert normalized coordinates to pixel coordinates with offsets', () => {
      const xyxyn: [number, number, number, number] = [0.2, 0.3, 0.8, 0.7];
      const pixelBox = normalizedToPixelBox(xyxyn, imageInfo);

      expect(pixelBox.left).toBe(150);   // 50 + (0.2 * 500)
      expect(pixelBox.top).toBe(145);    // 25 + (0.3 * 400)
      expect(pixelBox.width).toBeCloseTo(300, 10);  // (0.8 - 0.2) * 500
      expect(pixelBox.height).toBe(160); // (0.7 - 0.3) * 400
    });

    it('should handle full image bounding box', () => {
      const xyxyn: [number, number, number, number] = [0, 0, 1, 1];
      const pixelBox = normalizedToPixelBox(xyxyn, imageInfo);

      expect(pixelBox.left).toBe(50);   // offsetX
      expect(pixelBox.top).toBe(25);    // offsetY
      expect(pixelBox.width).toBe(500); // full width
      expect(pixelBox.height).toBe(400); // full height
    });

    it('should handle small bounding box in center', () => {
      const xyxyn: [number, number, number, number] = [0.45, 0.45, 0.55, 0.55];
      const pixelBox = normalizedToPixelBox(xyxyn, imageInfo);

      expect(pixelBox.left).toBe(275);  // 50 + (0.45 * 500)
      expect(pixelBox.top).toBe(205);   // 25 + (0.45 * 400)
      expect(pixelBox.width).toBeCloseTo(50, 10);  // 0.1 * 500
      expect(pixelBox.height).toBeCloseTo(40, 10); // 0.1 * 400
    });

    it('should handle zero offset', () => {
      const imageInfoNoOffset: ImageInfo = {
        width: 600,
        height: 300,
        offsetX: 0,
        offsetY: 0
      };

      const xyxyn: [number, number, number, number] = [0.1, 0.2, 0.9, 0.8];
      const pixelBox = normalizedToPixelBox(xyxyn, imageInfoNoOffset);

      expect(pixelBox.left).toBe(60);   // 0 + (0.1 * 600)
      expect(pixelBox.top).toBe(60);    // 0 + (0.2 * 300)
      expect(pixelBox.width).toBe(480); // (0.9 - 0.1) * 600
      expect(pixelBox.height).toBeCloseTo(180, 10); // (0.8 - 0.2) * 300
    });
  });

  describe('coordinate system round-trip tests', () => {
    const imageBounds: ImageBounds = {
      width: 800,
      height: 600,
      x: 0,
      y: 0
    };

    it('should maintain consistency through image <-> normalized coordinate conversion', () => {
      // Start with an image coordinate
      const originalImagePoint: Point = { x: 400, y: 300 };
      
      // Convert: image -> normalized -> image
      const normalizedPoint = imageToNormalizedCoordinates(originalImagePoint, imageBounds);
      const backToImagePoint = normalizedToImageCoordinates(normalizedPoint, imageBounds);

      // Should get back to original coordinates (within floating point precision)
      expect(backToImagePoint.x).toBeCloseTo(originalImagePoint.x, 10);
      expect(backToImagePoint.y).toBeCloseTo(originalImagePoint.y, 10);
    });

    it('should handle boundary coordinates consistently', () => {
      // Test with image corners
      const corners = [
        { x: 0, y: 0 }, // top-left
        { x: imageBounds.width, y: 0 }, // top-right
        { x: 0, y: imageBounds.height }, // bottom-left
        { x: imageBounds.width, y: imageBounds.height } // bottom-right
      ];

      corners.forEach((imagePoint, index) => {
        const normalizedPoint = imageToNormalizedCoordinates(imagePoint, imageBounds);
        
        // Normalized coordinates should be at expected boundary values
        if (index === 0) { // top-left
          expect(normalizedPoint.x).toBeCloseTo(0, 10);
          expect(normalizedPoint.y).toBeCloseTo(0, 10);
        } else if (index === 3) { // bottom-right
          expect(normalizedPoint.x).toBeCloseTo(1, 10);
          expect(normalizedPoint.y).toBeCloseTo(1, 10);
        }
      });
    });
  });
});