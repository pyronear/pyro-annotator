/**
 * Unit tests for image utilities.
 * These tests verify image dimension calculations and aspect ratios.
 */

import { describe, it, expect } from 'vitest';
import {
  calculateAspectRatio,
  getImageDimensions,
  fitImageToContainer,
  coverContainer,
  calculateOptimalZoom,
  isValidImageSize,
  getImageScale,
  formatImageDimensions,
  getAspectRatioLabel,
  ImageDimensions,
  DisplayDimensions
} from '@/utils/annotation/imageUtils';

describe('imageUtils', () => {
  describe('calculateAspectRatio', () => {
    it('should calculate correct aspect ratio', () => {
      const ratio = calculateAspectRatio(1920, 1080);
      expect(ratio).toBeCloseTo(1.7777, 3);
    });

    it('should return 1 for square images', () => {
      const ratio = calculateAspectRatio(500, 500);
      expect(ratio).toBe(1);
    });

    it('should handle zero height', () => {
      const ratio = calculateAspectRatio(1920, 0);
      expect(ratio).toBe(1);
    });

    it('should calculate ratio for portrait images', () => {
      const ratio = calculateAspectRatio(1080, 1920);
      expect(ratio).toBeCloseTo(0.5625, 4);
    });
  });

  describe('getImageDimensions', () => {
    it('should return correct image dimensions', () => {
      const dims = getImageDimensions(1920, 1080);
      
      expect(dims.width).toBe(1920);
      expect(dims.height).toBe(1080);
      expect(dims.aspectRatio).toBeCloseTo(1.7777, 3);
    });

    it('should handle square images', () => {
      const dims = getImageDimensions(800, 800);
      
      expect(dims.width).toBe(800);
      expect(dims.height).toBe(800);
      expect(dims.aspectRatio).toBe(1);
    });
  });

  describe('fitImageToContainer', () => {
    it('should fit wide image to container width', () => {
      // Image wider than container
      const display = fitImageToContainer(1920, 1080, 800, 600);
      
      expect(display.displayWidth).toBe(800);
      expect(display.displayHeight).toBeCloseTo(450, 1); // 800/1.777
      expect(display.offsetX).toBe(0);
      expect(display.offsetY).toBe(75); // (600-450)/2
      expect(display.scale).toBeCloseTo(0.4166, 3); // 800/1920
    });

    it('should fit tall image to container height', () => {
      // Image taller than container
      const display = fitImageToContainer(1080, 1920, 800, 600);
      
      expect(display.displayHeight).toBe(600);
      expect(display.displayWidth).toBe(337.5); // 600 * (1080/1920)
      expect(display.offsetX).toBe(231.25); // (800-337.5)/2
      expect(display.offsetY).toBe(0);
      expect(display.scale).toBeCloseTo(0.3125, 4); // 600/1920
    });

    it('should handle perfect fit', () => {
      const display = fitImageToContainer(800, 600, 800, 600);
      
      expect(display.displayWidth).toBe(800);
      expect(display.displayHeight).toBe(600);
      expect(display.offsetX).toBe(0);
      expect(display.offsetY).toBe(0);
      expect(display.scale).toBe(1);
    });

    it('should handle square image in square container', () => {
      const display = fitImageToContainer(500, 500, 400, 400);
      
      expect(display.displayWidth).toBe(400);
      expect(display.displayHeight).toBe(400);
      expect(display.offsetX).toBe(0);
      expect(display.offsetY).toBe(0);
      expect(display.scale).toBe(0.8); // 400/500
    });
  });

  describe('coverContainer', () => {
    it('should cover container with wide image', () => {
      // Wide image covering tall container
      const display = coverContainer(1920, 1080, 800, 1200);
      
      expect(display.displayHeight).toBe(1200);
      expect(display.displayWidth).toBeCloseTo(2133.33, 1); // 1200 * (1920/1080)
      expect(display.offsetX).toBeCloseTo(-666.67, 1); // (800-2133.33)/2
      expect(display.offsetY).toBe(0);
      expect(display.scale).toBeCloseTo(1.111, 3); // 1200/1080
    });

    it('should cover container with tall image', () => {
      // Tall image covering wide container
      const display = coverContainer(1080, 1920, 1200, 800);
      
      expect(display.displayWidth).toBe(1200);
      expect(display.displayHeight).toBeCloseTo(2133.33, 1); // 1200 * (1920/1080)
      expect(display.offsetX).toBe(0);
      expect(display.offsetY).toBeCloseTo(-666.67, 1); // (800-2133.33)/2
      expect(display.scale).toBeCloseTo(1.111, 3); // 1200/1080
    });

    it('should handle perfect cover', () => {
      const display = coverContainer(800, 600, 800, 600);
      
      expect(display.displayWidth).toBe(800);
      expect(display.displayHeight).toBe(600);
      expect(display.offsetX).toBe(0);
      expect(display.offsetY).toBe(0);
      expect(display.scale).toBe(1);
    });
  });

  describe('calculateOptimalZoom', () => {
    it('should calculate fit zoom for wide image', () => {
      const zoom = calculateOptimalZoom(1920, 1080, 800, 600, 'fit');
      expect(zoom).toBeCloseTo(0.4166, 3); // min(800/1920, 600/1080)
    });

    it('should calculate fill zoom for wide image', () => {
      const zoom = calculateOptimalZoom(1920, 1080, 800, 600, 'fill');
      expect(zoom).toBeCloseTo(0.556, 3); // max(800/1920, 600/1080)
    });

    it('should return 1.0 for actual size mode', () => {
      const zoom = calculateOptimalZoom(1920, 1080, 800, 600, 'actual');
      expect(zoom).toBe(1.0);
    });

    it('should use fit mode as default', () => {
      const zoom = calculateOptimalZoom(1920, 1080, 800, 600);
      expect(zoom).toBeCloseTo(0.4166, 3);
    });

    it('should handle zoom > 1 for small images', () => {
      const zoom = calculateOptimalZoom(400, 300, 800, 600, 'fit');
      expect(zoom).toBe(2.0); // min(800/400, 600/300)
    });
  });

  describe('isValidImageSize', () => {
    it('should validate normal image sizes', () => {
      const isValid = isValidImageSize(1920, 1080, 100);
      expect(isValid).toBe(true);
    });

    it('should reject images smaller than minimum', () => {
      const isValid = isValidImageSize(50, 1080, 100);
      expect(isValid).toBe(false);
    });

    it('should use default minimum size', () => {
      const isValid = isValidImageSize(2, 2);
      expect(isValid).toBe(true); // Default min is 1
      
      const isInvalid = isValidImageSize(0, 2);
      expect(isInvalid).toBe(false);
    });

    it('should reject infinite dimensions', () => {
      const isValid = isValidImageSize(Infinity, 1080, 100);
      expect(isValid).toBe(false);
    });

    it('should reject negative dimensions', () => {
      const isValid = isValidImageSize(-100, 1080, 100);
      expect(isValid).toBe(false);
    });
  });

  describe('getImageScale', () => {
    it('should calculate uniform scale factor', () => {
      const scale = getImageScale(1920, 1080, 960, 540);
      expect(scale).toBe(0.5);
    });

    it('should return minimum scale for non-uniform scaling', () => {
      // If display dimensions don't maintain aspect ratio, return minimum
      const scale = getImageScale(1920, 1080, 800, 600);
      expect(scale).toBeCloseTo(0.4166, 3); // min(800/1920, 600/1080)
    });

    it('should handle 1:1 scaling', () => {
      const scale = getImageScale(800, 600, 800, 600);
      expect(scale).toBe(1);
    });

    it('should handle upscaling', () => {
      const scale = getImageScale(400, 300, 800, 600);
      expect(scale).toBe(2);
    });

    it('should handle zero original dimensions', () => {
      const scale = getImageScale(0, 300, 800, 600);
      expect(scale).toBe(2); // min(800/0->Infinity, 600/300->2) = 2
    });
  });

  describe('formatImageDimensions', () => {
    it('should format dimensions with multiplication symbol', () => {
      const formatted = formatImageDimensions(1920, 1080);
      expect(formatted).toBe('1920×1080');
    });

    it('should round fractional dimensions', () => {
      const formatted = formatImageDimensions(1920.7, 1080.3);
      expect(formatted).toBe('1921×1080');
    });

    it('should handle zero dimensions', () => {
      const formatted = formatImageDimensions(0, 0);
      expect(formatted).toBe('0×0');
    });

    it('should handle small dimensions', () => {
      const formatted = formatImageDimensions(10, 20);
      expect(formatted).toBe('10×20');
    });
  });

  describe('getAspectRatioLabel', () => {
    it('should identify common 16:9 ratio', () => {
      const label = getAspectRatioLabel(1.777);
      expect(label).toBe('16:9');
    });

    it('should identify common 4:3 ratio', () => {
      const label = getAspectRatioLabel(1.333);
      expect(label).toBe('4:3');
    });

    it('should identify square ratio', () => {
      const label = getAspectRatioLabel(1.0);
      expect(label).toBe('1:1');
    });

    it('should identify 3:2 ratio', () => {
      const label = getAspectRatioLabel(1.5);
      expect(label).toBe('3:2');
    });

    it('should identify cinematic ratios', () => {
      const label185 = getAspectRatioLabel(1.85);
      expect(label185).toBe('1.85:1');
      
      const label235 = getAspectRatioLabel(2.35);
      expect(label235).toBe('2.35:1');
    });

    it('should identify ultra-wide 21:9 ratio', () => {
      const label = getAspectRatioLabel(2.39);
      expect(label).toBe('21:9');
    });

    it('should return decimal format for uncommon ratios', () => {
      const label = getAspectRatioLabel(1.42);
      expect(label).toBe('1.42:1');
    });

    it('should use custom tolerance', () => {
      // With very tight tolerance, shouldn't match 16:9
      const label = getAspectRatioLabel(1.78, 0.001);
      expect(label).toBe('1.78:1');
      
      // With loose tolerance, should match 16:9
      const labelLoose = getAspectRatioLabel(1.78, 0.01);
      expect(labelLoose).toBe('16:9');
    });

    it('should handle very small ratios', () => {
      const label = getAspectRatioLabel(0.5);
      expect(label).toBe('0.50:1');
    });

    it('should handle very large ratios', () => {
      const label = getAspectRatioLabel(3.5);
      expect(label).toBe('3.50:1');
    });
  });
});