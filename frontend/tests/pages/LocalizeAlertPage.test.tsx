/**
 * Tests for LocalizeAlertPage: the collocated localize screen. Task 3 scope
 * — data loading, status strip, frame grid. Task 4 adds per-frame editing
 * (cell click -> ImageModal, URL-driven via the optional :detectionId),
 * per-object quick-accept, and the S/M/L card-size + crop-zoom view
 * controls.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type {
  AlertDetail,
  Sequence,
  SequenceAnnotation,
  Detection,
  DetectionAnnotation,
} from '@/types/api';

vi.mock('@/services/api', () => ({
  apiClient: {
    getSequence: vi.fn(),
    getAlertDetail: vi.fn(),
    getSequenceDetections: vi.fn(),
    getDetectionAnnotations: vi.fn(),
    getDetectionImageUrl: vi.fn(),
    createDetectionAnnotation: vi.fn(),
    updateDetectionAnnotation: vi.fn(),
  },
}));

vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  default: () => <div data-testid="cropped-image-sequence" />,
}));

// ImageModal is a heavy, canvas/keyboard-driven editor covered by its own
// unit-level pieces elsewhere; here it's stubbed to a thin, inspectable
// stand-in so LocalizeAlertPage's wiring (which detection/lane it opens for,
// how a submit routes to saveDetectionReview) can be tested without
// exercising canvas drawing.
vi.mock('@/components/detection-sequence/ImageModal', () => ({
  ImageModal: (props: {
    detection: Detection;
    onClose: () => void;
    onSubmit: (
      detection: Detection,
      items: unknown[],
      currentDrawMode: boolean,
      options?: { autoSave?: boolean }
    ) => void;
  }) => (
    <div data-testid="image-modal">
      <span data-testid="image-modal-detection-id">{props.detection.id}</span>
      <button
        type="button"
        onClick={() =>
          props.onSubmit(
            props.detection,
            [{ xyxyn: [0.1, 0.1, 0.2, 0.2], class_name: 'smoke', smoke_type: 'wildfire' }],
            false
          )
        }
      >
        Mock Submit
      </button>
      <button type="button" onClick={props.onClose}>
        Mock Close
      </button>
    </div>
  ),
}));

import { apiClient } from '@/services/api';
import LocalizeAlertPage from '@/pages/LocalizeAlertPage';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/localize/101']}>
        <Routes>
          <Route path="/localize/:sequenceId/:detectionId?" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function makeSequence(overrides: Partial<Sequence> = {}): Sequence {
  return {
    id: 101,
    source_api: 'pyronear_french',
    alert_api_id: 9001,
    created_at: '2026-01-01T09:00:00Z',
    recorded_at: '2026-01-01T10:00:00Z',
    last_seen_at: '2026-01-01T10:05:00Z',
    camera_name: 'CAM-1',
    camera_id: 1,
    lat: 45,
    lon: 5,
    azimuth: 90,
    is_wildfire_alertapi: null,
    organisation_name: 'Org',
    organisation_id: 1,
    platform_alert_id: 500,
    sequence_group_id: null,
    ...overrides,
  };
}

function makeAnnotation(overrides: Partial<SequenceAnnotation> = {}): SequenceAnnotation {
  return {
    id: 201,
    sequence_id: 101,
    has_smoke: true,
    has_false_positives: false,
    false_positive_types: '[]',
    smoke_types: ['wildfire'],
    has_missed_smoke: false,
    is_unsure: false,
    annotation: { sequences_bbox: [] },
    processing_stage: 'seq_annotation_done',
    created_at: '2026-01-01T09:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

const T1 = '2026-01-01T10:00:00Z';
const T2 = '2026-01-01T10:05:00Z';

function makeDetection(id: number, recordedAt: string): Detection {
  return {
    id,
    sequence_id: 0,
    alert_api_id: 0,
    created_at: recordedAt,
    recorded_at: recordedAt,
    algo_predictions: { predictions: [] },
    auto_predictions: {
      predictions: [{ xyxyn: [0.1, 0.1, 0.3, 0.3], confidence: 0.9, class_name: 'smoke' }],
    },
    last_modified_at: null,
  };
}

function makeTwoLaneAlertDetail(): AlertDetail {
  return {
    source_api: 'pyronear_french',
    platform_alert_id: 500,
    camera_name: 'CAM-1',
    organisation_name: 'Org',
    recorded_at: '2026-01-01T10:00:00Z',
    lanes: [
      {
        sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
        annotation: makeAnnotation({ id: 201, sequence_id: 101 }),
      },
      {
        sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
        annotation: makeAnnotation({ id: 202, sequence_id: 102 }),
      },
    ],
  };
}

const emptyAnnotationsPage = { items: [], page: 1, pages: 1, size: 100, total: 0 };

/**
 * Renders and waits for the async chain (sequence -> alert-detail ->
 * per-lane detections) to settle far enough for real frame data to have
 * landed — waiting for testid presence alone can catch the page mid-flight,
 * before `useQueries` has resolved every lane's detections, when the strip
 * rows exist structurally but carry zero frame segments yet.
 */
async function renderAndSettle(
  ui: React.ReactElement,
  options: { wrapper: React.ComponentType<{ children: React.ReactNode }> }
): Promise<void> {
  render(ui, options);
  await waitFor(() => {
    expect(screen.getByTestId('status-segment-0-0')).toBeInTheDocument();
  });
}

describe('LocalizeAlertPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(apiClient.getSequence).mockResolvedValue(makeSequence());
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(makeTwoLaneAlertDetail());
    vi.mocked(apiClient.getDetectionAnnotations).mockResolvedValue(emptyAnnotationsPage);
    vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
      if (id === 101) return [makeDetection(1001, T1)];
      if (id === 102) return [makeDetection(1002, T1), makeDetection(1003, T2)];
      return [];
    });
    vi.mocked(apiClient.getDetectionImageUrl).mockImplementation(async (id: number) => ({
      url: `https://img.example/${id}.jpg`,
    }));
  });

  it('renders a status strip row and a grid cell for each object of a 2-object alert', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(
      within(screen.getByTestId('object-status-row-0')).getByText('Object 1')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('object-status-row-1')).getByText('Object 2')
    ).toBeInTheDocument();

    // Union of frames: T1 (both lanes) + T2 (lane 102 only) = 2 grid cells.
    expect(screen.getByTestId(`alert-frame-cell-${T1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`alert-frame-cell-${T2}`)).toBeInTheDocument();

    // Both lanes are seq_annotation_done (workable) -> no context strip.
    expect(screen.queryByTestId('context-object-strip')).not.toBeInTheDocument();

    expect(screen.getByText('2 objects')).toBeInTheDocument();
  });

  it('clicking a strip row activates that object (the shared frame now shows its detection)', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Before activation: T1's cell falls back to the first lane present (Object 1 / detection 1001).
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img).toHaveAttribute('src', 'https://img.example/1001.jpg');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 2' }));

    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img).toHaveAttribute('src', 'https://img.example/1002.jpg');
    });
  });

  it('clicking a segment activates its object and scrolls the grid to that frame', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Object 2's row (index 1) has segments for both T1 and T2; frame index 1 is T2.
    fireEvent.click(screen.getByTestId('status-segment-1-1'));

    // The scroll happens inside a requestAnimationFrame callback (mirrors
    // ClassifyAlertPage's presence-strip click handler), so it lands a tick
    // after the click event itself.
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img).toHaveAttribute('src', 'https://img.example/1002.jpg');
    });
  });

  it('renders a single row for a single-object alert', async () => {
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
      ...makeTwoLaneAlertDetail(),
      lanes: [
        {
          sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
          annotation: makeAnnotation({ id: 201, sequence_id: 101 }),
        },
      ],
    });
    vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) =>
      id === 101 ? [makeDetection(1001, T1)] : []
    );

    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(screen.getAllByTestId(/^object-status-row-/)).toHaveLength(1);
    expect(screen.getByText('1 object')).toBeInTheDocument();
  });

  it("clicking a grid cell with no active object opens the first-present lane's detection and makes it active", async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // T2 only has lane 102 (Object 2 / detection 1003) present.
    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));

    await waitFor(() => {
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003');
    });

    fireEvent.click(screen.getByText('Mock Close'));
    await waitFor(() => expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument());

    // Lane 102 was made active by the earlier cell click, so T1 (present in
    // both lanes) now shows its detection without any further row/segment click.
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img).toHaveAttribute('src', 'https://img.example/1002.jpg');
    });
  });

  it("clicking a grid cell opens the ACTIVE object's detection at that frame when the active lane is present there", async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 2' }));
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img).toHaveAttribute('src', 'https://img.example/1002.jpg');
    });

    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T1}`));

    await waitFor(() => {
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1002');
    });
  });

  it('saving a frame in the modal creates the annotation via saveDetectionReview, closes the editor, and redraws the grid status', async () => {
    let lane101Items: DetectionAnnotation[] = [];
    vi.mocked(apiClient.getDetectionAnnotations).mockImplementation(
      async (filters?: { sequence_id?: number }) => {
        if (filters?.sequence_id === 101) {
          return { ...emptyAnnotationsPage, items: lane101Items };
        }
        return emptyAnnotationsPage;
      }
    );
    vi.mocked(apiClient.createDetectionAnnotation).mockImplementation(async payload => {
      const created: DetectionAnnotation = {
        id: 9001,
        detection_id: payload.detection_id,
        annotation: payload.annotation,
        processing_stage: payload.processing_stage,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: null,
      };
      lane101Items = [created];
      return created;
    });

    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // No active object: T1 falls back to the first present lane (Object 1 / detection 1001, no existing annotation).
    expect(screen.getByTestId(`alert-frame-status-${T1}`)).toHaveTextContent('0/2');
    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T1}`));
    await waitFor(() => {
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1001');
    });

    fireEvent.click(screen.getByText('Mock Submit'));

    await waitFor(() => {
      expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ detection_id: 1001, processing_stage: 'annotated' })
      );
    });
    expect(apiClient.updateDetectionAnnotation).not.toHaveBeenCalled();

    // A non-autoSave submit closes the editor (URL drops :detectionId).
    await waitFor(() => {
      expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument();
    });

    // Only lane 101's detection-annotations query was invalidated/refetched
    // — the grid status for T1 now reflects one committed box of two.
    await waitFor(() => {
      expect(screen.getByTestId(`alert-frame-status-${T1}`)).toHaveTextContent('1/2');
    });

    expect(screen.getByText('Frame saved')).toBeInTheDocument();
  });

  it("per-object quick-accept saves only that lane's frames, scoped per lane", async () => {
    vi.mocked(apiClient.createDetectionAnnotation).mockImplementation(async payload => ({
      id: 9100 + payload.detection_id,
      detection_id: payload.detection_id,
      annotation: payload.annotation,
      processing_stage: payload.processing_stage,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: null,
    }));

    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: "Accept Object 1's boxes" }));

    await waitFor(() => {
      expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith(
        expect.objectContaining({ detection_id: 1001 })
      );
    });

    // Object 1's lane only has detection 1001 — Object 2's frames (1002, 1003)
    // must never be touched by Object 1's quick-accept button.
    expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalledWith(
      expect.objectContaining({ detection_id: 1002 })
    );
    expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalledWith(
      expect.objectContaining({ detection_id: 1003 })
    );
    expect(apiClient.updateDetectionAnnotation).not.toHaveBeenCalled();
  });

  it('the S/M/L card-size control resizes the grid and persists to the key shared with the legacy page', async () => {
    const { container } = render(<LocalizeAlertPage />, { wrapper: wrapper });
    await waitFor(() => expect(screen.getByTestId('status-segment-0-0')).toBeInTheDocument());

    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain('340px'); // default 'md'

    fireEvent.click(screen.getByTitle('Large cards'));

    expect(grid.style.gridTemplateColumns).toContain('500px');
    expect(localStorage.getItem('detectionAnnotateCardSize')).toBe('lg');
  });

  it('crop mode zooms grid cells around the active object\'s boxes, and is inert without an active object (toolbar + "c" shortcut)', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    fireEvent.click(screen.getByTitle('Crop cells (C)'));

    // No active object yet -> the cell stays full-frame.
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toBe('');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }));

    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });

    // The 'c' shortcut toggles it back off.
    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toBe('');
    });
  });

  it('a timeline row shows its boxes preview in a popover on hover, never inline', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('object-status-label-wrap-0'));

    await waitFor(() => {
      expect(screen.getByTestId('cropped-image-sequence')).toBeInTheDocument();
    });
  });
});
