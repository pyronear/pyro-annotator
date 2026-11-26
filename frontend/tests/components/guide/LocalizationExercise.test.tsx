import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import LocalizationExercise from '@/components/guide/LocalizationExercise';
import { LOCALIZATION_EXERCISES } from '@/components/guide/localizationExercises';
import { celebrate } from '@/components/guide/celebrate';
import type { Xyxyn } from '@/hooks/annotation';

vi.mock('@/components/guide/celebrate', () => ({ celebrate: vi.fn() }));

// jsdom has no layout, so a real drag can't be turned into a box. Stub the
// drawing surface and draw through the callback it was given.
let drawBox: (xyxyn: Xyxyn) => void = () => {};
vi.mock('@/hooks/annotation', () => ({
  useBoxDrawingStage: ({ onDrawn }: { onDrawn: (xyxyn: Xyxyn) => void }) => {
    drawBox = onDrawn;
    const noop = () => {};
    return {
      imageInfo: null,
      handleImageLoad: noop,
      zoomLevel: 1,
      panOffset: { x: 0, y: 0 },
      isDragging: false,
      spaceHeld: false,
      currentDrawing: null,
      boxEdit: null,
      handleMouseDown: noop,
      handleMouseMove: noop,
      handleMouseUp: noop,
      handleBoxPointerDown: noop,
      handleHandlePointerDown: noop,
      getCursorStyle: () => 'crosshair',
      screenToImageCoords: () => ({ x: 0, y: 0 }),
      imageToNormalized: () => ({ x: 0, y: 0 }),
      normalizedToImage: () => ({ x: 0, y: 0 }),
      resetZoom: noop,
      applyView: noop,
      resetTransient: noop,
    };
  },
}));

const MISS: Xyxyn = [0, 0, 0.01, 0.01];

const draw = (xyxyn: Xyxyn) => act(() => drawBox(xyxyn));
const checkButton = () => screen.getByRole('button', { name: 'Check my box' });

/** Answer every image: a match where `matches[i]`, a miss otherwise. */
const answerAll = (matches: boolean[]) => {
  LOCALIZATION_EXERCISES.forEach((exercise, i) => {
    draw(matches[i] ? exercise.reference : MISS);
    fireEvent.click(checkButton());
    fireEvent.click(screen.getByRole('button', { name: /next image|see my result/i }));
  });
};

describe('LocalizationExercise', () => {
  it('only lets a box be checked once one is drawn', () => {
    render(<LocalizationExercise afterPass={<p>Go localize</p>} />);
    expect(screen.getByText(/image 1 of 5/i)).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
    draw(LOCALIZATION_EXERCISES[0].reference);
    expect(checkButton()).toBeEnabled();
  });

  it('ticks a box that matches the expected one', () => {
    render(<LocalizationExercise afterPass={null} />);
    draw(LOCALIZATION_EXERCISES[0].reference);
    fireEvent.click(checkButton());
    expect(screen.getByTestId('verdict-tick')).toBeInTheDocument();
    expect(screen.getByText(/100% overlap/)).toBeInTheDocument();
    expect(screen.getByLabelText('Image 1: match')).toBeInTheDocument();
  });

  it('crosses a box that misses, and says what to fix', () => {
    render(<LocalizationExercise afterPass={null} />);
    draw(MISS);
    fireEvent.click(checkButton());
    expect(screen.getByTestId('verdict-cross')).toBeInTheDocument();
    expect(screen.getByText('Your box misses the smoke.')).toBeInTheDocument();
    expect(screen.getByLabelText('Image 1: miss')).toBeInTheDocument();
  });

  it('passes with 4 matches out of 5: confetti, then the next step', () => {
    vi.mocked(celebrate).mockClear();
    render(<LocalizationExercise afterPass={<p>Go localize</p>} />);
    answerAll([true, false, true, true, true]);
    expect(screen.getByText("Passed — you're ready to localize!")).toBeInTheDocument();
    expect(screen.getByText('Go localize')).toBeInTheDocument();
    expect(celebrate).toHaveBeenCalledTimes(1);
  });

  it('fails with 3 matches and offers a fresh attempt', () => {
    vi.mocked(celebrate).mockClear();
    render(<LocalizationExercise afterPass={<p>Go localize</p>} />);
    answerAll([true, false, true, false, true]);
    expect(screen.getByText(/you need 4 matching boxes/i)).toBeInTheDocument();
    expect(screen.queryByText('Go localize')).not.toBeInTheDocument();
    expect(celebrate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText(/image 1 of 5/i)).toBeInTheDocument();
    expect(checkButton()).toBeDisabled();
  });
});
