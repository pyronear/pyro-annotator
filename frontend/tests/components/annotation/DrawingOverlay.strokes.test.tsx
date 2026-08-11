/**
 * Stroke weights on the localize editor's drawing layer.
 *
 * Everything DrawingOverlay renders sits inside a `scale(zoomLevel)` transform,
 * so a width authored in flat CSS pixels is multiplied on screen. That matters
 * here more than anywhere: an annotator zooms in precisely because the smoke is
 * a few pixels across, and a stroke that grows with the zoom covers the pixels
 * being aimed at.
 *
 * The strokes are therefore PAINTED (box-shadow spread / background bands) and
 * never laid out as CSS borders, which Blink clamps to a minimum of one device
 * pixel per unit of zoom. See `utils/annotation/hairlineStroke`.
 */

import React from 'react';
import { render } from '@testing-library/react';
import { DrawingOverlay } from '@/components/annotation/ImageOverlays';
import { ImageInfo } from '@/utils/annotation/coordinateUtils';

const imageInfo: ImageInfo = { width: 100, height: 100, offsetX: 0, offsetY: 0 };

const baseProps = {
  imageInfo,
  panOffset: { x: 0, y: 0 },
  transformOrigin: { x: 50, y: 50 },
  isDragging: false,
  normalizedToImage: (x: number, y: number) => ({ x: x * 100, y: y * 100 }),
};

/**
 * Spread radius of the box-shadow ring, i.e. the coloured stroke width. It is
 * the last length in `0 0 0 <spread>px <color>`; the leading zeros may or may
 * not carry a unit depending on who serialised the value.
 */
const spreadOf = (boxShadow: string) => {
  const lengths = boxShadow.match(/[\d.]+px/g) ?? [];
  return parseFloat(lengths[lengths.length - 1]);
};

const renderBand = (strokeScale: number) =>
  render(
    <DrawingOverlay
      {...baseProps}
      drawnRectangles={[]}
      currentDrawing={{ startX: 10, startY: 10, currentX: 30, currentY: 30 }}
      selectedRectangleId={null}
      zoomLevel={strokeScale}
      strokeScale={strokeScale}
    />
  ).container.querySelector('[data-testid="drawing-rubber-band"]') as HTMLElement;

const renderBox = (strokeScale: number, selected: boolean) =>
  render(
    <DrawingOverlay
      {...baseProps}
      drawnRectangles={[{ id: 'box-1', xyxyn: [0.1, 0.1, 0.2, 0.2] }]}
      currentDrawing={null}
      selectedRectangleId={selected ? 'box-1' : null}
      zoomLevel={strokeScale}
      strokeScale={strokeScale}
      boxColor="#FF2D95"
      boxWidth={2}
    />
  ).container.querySelector('[data-testid="drawn-box-box-1"]') as HTMLElement;

describe('DrawingOverlay stroke weights', () => {
  it('divides the in-progress rubber band by the zoom', () => {
    const widthAt = (scale: number) => spreadOf(renderBand(scale).style.boxShadow);

    const at1x = widthAt(1);
    expect(at1x).toBeGreaterThan(0);
    expect(widthAt(4)).toBeCloseTo(at1x / 4);
  });

  it('divides the committed box stroke by the zoom', () => {
    const at1x = spreadOf(renderBox(1, false).style.boxShadow);
    expect(at1x).toBeCloseTo(2);
    expect(spreadOf(renderBox(4, false).style.boxShadow)).toBeCloseTo(0.5);
  });

  it('keeps a selected box only marginally heavier than an unselected one', () => {
    // Selection is signalled mostly by the resize handles; the stroke bump is
    // a hint, not a second box drawn on top of the first.
    const bump =
      spreadOf(renderBox(1, true).style.boxShadow) - spreadOf(renderBox(1, false).style.boxShadow);
    expect(bump).toBeCloseTo(1);
  });

  it('never lays the strokes out as CSS borders, at any zoom', () => {
    // A border would floor to 1 layout px and paint at `zoom` device px,
    // silently discarding every width above.
    //
    // Checked as class AND inline style, because the two strokes regressed
    // differently: the committed box set `borderWidth` inline, while the
    // rubber band carried `border-2 border-dashed` as a Tailwind class and
    // no inline border at all. Asserting on the style alone would let the
    // band's old markup sail through this guard.
    for (const scale of [1, 2, 3, 4]) {
      for (const el of [renderBox(scale, true), renderBand(scale)]) {
        expect(el.className).not.toMatch(/\bborder(-|\b)/);
        expect(el.style.borderWidth).toBe('');
      }
    }
  });
});
