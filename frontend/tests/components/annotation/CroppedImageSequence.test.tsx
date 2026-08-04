import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CroppedImageSequence from '@/components/annotation/CroppedImageSequence';
import { BoundingBox } from '@/types/api';

vi.mock('@/services/api', () => ({
  apiClient: {
    getDetectionImageUrl: vi.fn().mockResolvedValue({ url: 'http://img.test/1.jpg' }),
  },
}));

// jsdom has no canvas 2D context — stub what drawToCanvas touches.
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  // Images "load" instantly with fixed dimensions.
  class InstantImage {
    naturalWidth = 1280;
    naturalHeight = 720;
    onload: null | (() => void) = null;
    onerror: null | (() => void) = null;
    set src(_v: string) {
      queueMicrotask(() => this.onload?.());
    }
  }
  vi.stubGlobal('Image', InstantImage as unknown as typeof Image);
});

// 128px-wide bbox in a 1280x720 frame, centered — maxSquareZoom is 2.5.
const BBOXES: BoundingBox[] = [
  { detection_id: 1, xyxyn: [0.45, 0.45, 0.55, 0.55] },
  { detection_id: 2, xyxyn: [0.45, 0.45, 0.55, 0.55] },
];

async function renderLoaded() {
  render(<CroppedImageSequence bboxes={BBOXES} sequenceId={9} />);
  await waitFor(() => expect(screen.getByLabelText('Zoom in')).toBeInTheDocument());
}

describe('CroppedImageSequence', () => {
  it('renders a fixed square viewport with corner zoom controls and no reset', async () => {
    await renderLoaded();
    expect(screen.getByTestId('cropped-viewport').className).toContain('aspect-square');
    expect(screen.getByLabelText('Zoom out')).toBeInTheDocument();
    expect(screen.queryByLabelText('Reset zoom')).not.toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
  });

  it('wheel-zooms over the viewport even though it mounts after loading', async () => {
    // The viewport div does not exist during the loading state — the wheel
    // listener must bind when it appears (callback-ref state), not on mount.
    await renderLoaded();
    expect(screen.getByText('1.0x')).toBeInTheDocument();
    fireEvent.wheel(screen.getByTestId('cropped-viewport'), { deltaY: -100 });
    expect(screen.getByText('1.1x')).toBeInTheDocument();
  });

  it('frames the viewport in the object accent color when given', async () => {
    render(<CroppedImageSequence bboxes={BBOXES} sequenceId={9} accentColor="#E4572E" />);
    await waitFor(() => expect(screen.getByLabelText('Zoom in')).toBeInTheDocument());
    const viewport = screen.getByTestId('cropped-viewport');
    expect(viewport.className).toContain('border-2');
    expect(viewport.style.borderColor).toBe('rgb(228, 87, 46)');
  });

  it('starts at 1.0x with zoom-out disabled, and clamps zoom-in at the max', async () => {
    await renderLoaded();
    expect(screen.getByText('1.0x')).toBeInTheDocument();
    expect(screen.getByLabelText('Zoom out')).toBeDisabled();

    // Zoom runs to the flat MAX_ZOOM cap (8x), 0.5 per click from 1.0.
    const zoomIn = screen.getByLabelText('Zoom in');
    for (let i = 0; i < 20; i++) fireEvent.click(zoomIn);
    expect(screen.getByText('8.0x')).toBeInTheDocument();
    expect(zoomIn).toBeDisabled();
  });

  // The size ceiling used to be a Tailwind class. It became a prop so the
  // localize rail could pass a smaller one — every OTHER consumer must keep
  // the sizing it had, which is what the default encodes.
  it('caps the viewport at the classify sizing unless a consumer overrides it', async () => {
    await renderLoaded();
    expect(screen.getByTestId('cropped-viewport').style.maxWidth).toBe('min(380px, 33vh)');
  });

  it('takes a consumer max size, and keeps the accent border alongside it', async () => {
    render(
      <CroppedImageSequence
        bboxes={BBOXES}
        sequenceId={9}
        maxSize="min(100%, 22vh)"
        accentColor="#E4572E"
      />
    );
    await waitFor(() => expect(screen.getByLabelText('Zoom in')).toBeInTheDocument());

    const viewport = screen.getByTestId('cropped-viewport');
    expect(viewport.style.maxWidth).toBe('min(100%, 22vh)');
    // Both live on the same inline style object — one must not clobber the other.
    expect(viewport.style.borderColor).toBe('rgb(228, 87, 46)');
  });

  // The loop is disclosed inside the localize rail, which is a fixed-height
  // scroller. A blanket preventDefault would trap the wheel there: at the
  // clamp there is no zoom left to give, so the event has to fall through and
  // let the container scroll.
  it('stops swallowing the wheel once zoom is clamped, so its scroller keeps scrolling', async () => {
    await renderLoaded();

    const viewport = screen.getByTestId('cropped-viewport');
    // At MIN_ZOOM already: wheeling further out changes nothing.
    expect(screen.getByText('1.0x')).toBeInTheDocument();
    expect(fireEvent.wheel(viewport, { deltaY: 100, cancelable: true })).toBe(true);

    // A wheel that DOES move the zoom is still consumed.
    expect(fireEvent.wheel(viewport, { deltaY: -100, cancelable: true })).toBe(false);
    expect(screen.getByText('1.1x')).toBeInTheDocument();
  });
});
