/**
 * Unit tests for canvas utilities.
 * These tests verify canvas-specific calculations and transformations.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateZoomLevel,
  calculateTransformOrigin,
  calculatePanConstraints,
  constrainPan,
  isWithinCanvas,
  calculateSizeThreshold,
  getMouseRelativeToElement,
  isValidDrawingSize,
  getCanvasScale,
  ZoomConfig,
  PanConstraints
} from '@/utils/annotation/canvasUtils';

describe('canvasUtils', () => {
  describe('calculateZoomLevel', () => {
    it('should increase zoom level for negative wheel delta', () => {
      const newZoom = calculateZoomLevel(1.5, -100, { minZoom: 1.0, maxZoom: 5.0, zoomStep: 0.1 });
      expect(newZoom).toBe(1.6);
    });

    it('should decrease zoom level for positive wheel delta', () => {
      const newZoom = calculateZoomLevel(1.5, 100, { minZoom: 1.0, maxZoom: 5.0, zoomStep: 0.1 });
      expect(newZoom).toBe(1.4);
    });

    it('should clamp zoom level to minimum', () => {
      const newZoom = calculateZoomLevel(1.0, 100, { minZoom: 1.0, maxZoom: 5.0, zoomStep: 0.2 });
      expect(newZoom).toBe(1.0);
    });

    it('should clamp zoom level to maximum', () => {
      const newZoom = calculateZoomLevel(5.0, -100, { minZoom: 1.0, maxZoom: 5.0, zoomStep: 0.2 });
      expect(newZoom).toBe(5.0);
    });

    it('should use default config values', () => {
      const newZoom = calculateZoomLevel(1.5, -100);
      expect(newZoom).toBe(1.6); // Default zoomStep is 0.1
    });
  });

  describe('calculateTransformOrigin', () => {
    it('should calculate center origin correctly', () => {
      const origin = calculateTransformOrigin(400, 300, 800, 600);
      expect(origin.x).toBe(50);
      expect(origin.y).toBe(50);
    });

    it('should calculate top-left origin correctly', () => {
      const origin = calculateTransformOrigin(0, 0, 800, 600);
      expect(origin.x).toBe(0);
      expect(origin.y).toBe(0);
    });

    it('should calculate bottom-right origin correctly', () => {
      const origin = calculateTransformOrigin(800, 600, 800, 600);
      expect(origin.x).toBe(100);
      expect(origin.y).toBe(100);
    });

    it('should handle zero dimensions', () => {
      const origin = calculateTransformOrigin(100, 100, 0, 0);
      expect(origin.x).toBe(50);
      expect(origin.y).toBe(50);
    });

    it('should clamp values to 0-100 range', () => {
      const origin = calculateTransformOrigin(-100, 1000, 800, 600);
      expect(origin.x).toBe(0);
      expect(origin.y).toBe(100);
    });
  });

  describe('calculatePanConstraints', () => {
    it('should return zero constraints for zoom level 1', () => {
      const constraints = calculatePanConstraints(1.0, 800, 600, 800, 600);
      expect(constraints.minX).toBe(0);
      expect(constraints.maxX).toBe(0);
      expect(constraints.minY).toBe(0);
      expect(constraints.maxY).toBe(0);
    });

    it('should calculate correct constraints for 2x zoom', () => {
      const constraints = calculatePanConstraints(2.0, 800, 600, 800, 600);
      expect(constraints.minX).toBe(-400); // (800*2 - 800) / 2
      expect(constraints.maxX).toBe(400);
      expect(constraints.minY).toBe(-300); // (600*2 - 600) / 2
      expect(constraints.maxY).toBe(300);
    });

    it('should handle container smaller than image', () => {
      const constraints = calculatePanConstraints(2.0, 800, 600, 400, 300);
      expect(constraints.minX).toBe(-600); // (800*2 - 400) / 2
      expect(constraints.maxX).toBe(600);
      expect(constraints.minY).toBe(-450); // (600*2 - 300) / 2
      expect(constraints.maxY).toBe(450);
    });

    it('should handle zoom level less than 1', () => {
      const constraints = calculatePanConstraints(0.5, 800, 600, 800, 600);
      expect(constraints.minX).toBe(0);
      expect(constraints.maxX).toBe(0);
      expect(constraints.minY).toBe(0);
      expect(constraints.maxY).toBe(0);
    });

    it('should use image dimensions as default container', () => {
      const constraints = calculatePanConstraints(2.0, 800, 600);
      expect(constraints.minX).toBe(-400);
      expect(constraints.maxX).toBe(400);
      expect(constraints.minY).toBe(-300);
      expect(constraints.maxY).toBe(300);
    });
  });

  describe('constrainPan', () => {
    const constraints: PanConstraints = {
      minX: -200,
      maxX: 200,
      minY: -100,
      maxY: 100
    };

    it('should allow valid offsets', () => {
      const constrained = constrainPan({ x: 100, y: 50 }, constraints);
      expect(constrained.x).toBe(100);
      expect(constrained.y).toBe(50);
    });

    it('should clamp offset to maximum bounds', () => {
      const constrained = constrainPan({ x: 500, y: 300 }, constraints);
      expect(constrained.x).toBe(200);
      expect(constrained.y).toBe(100);
    });

    it('should clamp offset to minimum bounds', () => {
      const constrained = constrainPan({ x: -500, y: -300 }, constraints);
      expect(constrained.x).toBe(-200);
      expect(constrained.y).toBe(-100);
    });

    it('should handle zero constraints', () => {
      const zeroConstraints = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
      const constrained = constrainPan({ x: 100, y: 50 }, zeroConstraints);
      expect(constrained.x).toBe(0);
      expect(constrained.y).toBe(0);
    });
  });

  describe('isWithinCanvas', () => {
    it('should return true for point inside canvas', () => {
      const isInside = isWithinCanvas({ x: 400, y: 300 }, 800, 600);
      expect(isInside).toBe(true);
    });

    it('should return true for point on canvas edge', () => {
      const isInside = isWithinCanvas({ x: 0, y: 0 }, 800, 600);
      expect(isInside).toBe(true);
      
      const isInside2 = isWithinCanvas({ x: 800, y: 600 }, 800, 600);
      expect(isInside2).toBe(true);
    });

    it('should return false for point outside canvas', () => {
      const isInside = isWithinCanvas({ x: 900, y: 300 }, 800, 600);
      expect(isInside).toBe(false);
      
      const isInside2 = isWithinCanvas({ x: 400, y: 700 }, 800, 600);
      expect(isInside2).toBe(false);
    });

    it('should return false for negative coordinates', () => {
      const isInside = isWithinCanvas({ x: -10, y: 300 }, 800, 600);
      expect(isInside).toBe(false);
      
      const isInside2 = isWithinCanvas({ x: 400, y: -10 }, 800, 600);
      expect(isInside2).toBe(false);
    });
  });

  describe('calculateSizeThreshold', () => {
    it('should calculate correct threshold for given canvas width', () => {
      const threshold = calculateSizeThreshold(1000, 10);
      expect(threshold).toBe(0.01);
    });

    it('should use default minimum pixel size', () => {
      const threshold = calculateSizeThreshold(1000);
      expect(threshold).toBe(0.01);
    });

    it('should handle zero canvas width', () => {
      const threshold = calculateSizeThreshold(0, 10);
      expect(threshold).toBe(0.01);
    });

    it('should calculate threshold for different canvas sizes', () => {
      const threshold800 = calculateSizeThreshold(800, 20);
      expect(threshold800).toBe(0.025); // 20/800
      
      const threshold500 = calculateSizeThreshold(500, 5);
      expect(threshold500).toBe(0.01); // 5/500
    });
  });

  describe('getMouseRelativeToElement', () => {
    it('should calculate relative position correctly', () => {
      const elementRect = new DOMRect(100, 50, 800, 600);
      const relativePos = getMouseRelativeToElement(500, 300, elementRect);
      
      expect(relativePos.x).toBe(400); // 500 - 100
      expect(relativePos.y).toBe(250); // 300 - 50
    });

    it('should handle mouse at element origin', () => {
      const elementRect = new DOMRect(100, 50, 800, 600);
      const relativePos = getMouseRelativeToElement(100, 50, elementRect);
      
      expect(relativePos.x).toBe(0);
      expect(relativePos.y).toBe(0);
    });

    it('should handle negative relative positions', () => {
      const elementRect = new DOMRect(100, 50, 800, 600);
      const relativePos = getMouseRelativeToElement(50, 25, elementRect);
      
      expect(relativePos.x).toBe(-50);
      expect(relativePos.y).toBe(-25);
    });
  });

  describe('isValidDrawingSize', () => {
    const threshold = 0.01;

    it('should return true for valid drawing dimensions', () => {
      const isValid = isValidDrawingSize(0.1, 0.2, 0.8, 0.9, threshold);
      expect(isValid).toBe(true);
    });

    it('should return false for dimensions below threshold', () => {
      const isValid = isValidDrawingSize(0.1, 0.2, 0.105, 0.205, threshold);
      expect(isValid).toBe(false); // Width and height both < 0.01
    });

    it('should return false for zero dimensions', () => {
      const isValid = isValidDrawingSize(0.5, 0.5, 0.5, 0.5, threshold);
      expect(isValid).toBe(false);
    });

    it('should handle reversed coordinates', () => {
      const isValid = isValidDrawingSize(0.8, 0.9, 0.1, 0.2, threshold);
      expect(isValid).toBe(true); // Uses absolute difference
    });

    it('should return false if only width is valid', () => {
      const isValid = isValidDrawingSize(0.1, 0.5, 0.8, 0.505, threshold);
      expect(isValid).toBe(false); // Height < threshold
    });

    it('should return false if only height is valid', () => {
      const isValid = isValidDrawingSize(0.5, 0.1, 0.505, 0.8, threshold);
      expect(isValid).toBe(false); // Width < threshold
    });
  });

  describe('getCanvasScale', () => {
    it('should return device pixel ratio for high DPI', () => {
      const scale = getCanvasScale(2.0);
      expect(scale).toBe(2.0);
    });

    it('should return 1 for standard DPI', () => {
      const scale = getCanvasScale(1.0);
      expect(scale).toBe(1.0);
    });

    it('should return minimum of 1 for low DPI', () => {
      const scale = getCanvasScale(0.5);
      expect(scale).toBe(1);
    });

    it('should use default device pixel ratio', () => {
      const scale = getCanvasScale();
      expect(scale).toBeGreaterThanOrEqual(1);
    });

    it('should handle fractional pixel ratios', () => {
      const scale = getCanvasScale(1.5);
      expect(scale).toBe(1.5);
    });
  });
});