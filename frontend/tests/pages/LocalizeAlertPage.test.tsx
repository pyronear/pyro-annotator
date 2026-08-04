/**
 * Tests for LocalizeAlertPage: the collocated localize screen. Task 3 scope
 * — data loading, status strip, frame grid. Task 4 adds per-frame editing
 * (cell click -> ImageModal, URL-driven via the optional :detectionId),
 * per-object quick-accept, and the S/M/L card-size + crop-zoom view
 * controls. Post-Task-5 feedback round adds the segment-click arrival
 * highlight + shareable `?frame=` deep link, and object-focus mode
 * (crop-on + small cards while an object is the timeline's selected row).
 * Task 9 retires the ⚑ pseudo-object row in favor of "+ Add object" (a new
 * sibling lane, its own object row) and reworks the soft-confirm gate
 * around whether an object was added this session.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useParams, useSearchParams } from 'react-router-dom';
import type {
  AlertDetail,
  AlertLane,
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
    updateSequenceAnnotation: vi.fn(),
    localizeSubmit: vi.fn(),
    addObject: vi.fn(),
  },
}));

vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  // Exposes sequenceId so tests can assert WHICH lane's strip is showing.
  default: (props: { sequenceId: number }) => (
    <div data-testid="cropped-image-sequence" data-sequence-id={props.sequenceId} />
  ),
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
    objectOverlays?: Array<{ color: string; label: string; boxes: unknown[] }>;
  }) => (
    <div data-testid="image-modal">
      <span data-testid="image-modal-detection-id">{props.detection.id}</span>
      {/* Exposes the object-identity overlays LocalizeAlertPage computed for
          this frame, so tests can assert which OTHER objects' boxes it built
          (and under what label/color) without exercising the real overlay
          rendering — covered at the DetectionAnnotationCanvas/ImageOverlays
          level instead. */}
      <span data-testid="image-modal-object-overlays">
        {(props.objectOverlays ?? []).map(o => o.label).join(',')}
      </span>
      <button
        type="button"
        onClick={() =>
          props.onSubmit(
            props.detection,
            [
              {
                xyxyn: [0.1, 0.1, 0.2, 0.2],
                class_name: 'smoke',
                smoke_type: 'wildfire',
                origin: 'human',
              },
            ],
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
import { ROUTES } from '@/utils/routes';

/**
 * Stands in for the classify cockpit at the Reclassify destination, exposing
 * the lane id and `return` param it was reached with so the navigation can be
 * asserted without mounting ClassifyAlertPage.
 */
function ClassifyDestinationProbe() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  return (
    <div
      data-testid="classify-destination"
      data-lane-id={id}
      data-return={params.get('return') ?? ''}
    />
  );
}

function makeWrapper(initialPath = '/localize/101') {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/localize/:sequenceId/:detectionId?" element={children} />
            {/* A real route for the queue landing page so a post-submit
                `navigate(ROUTES.LOCALIZE)` is observable (it actually
                navigates, unlike a mocked useNavigate, which would also break
                the modal-close-on-navigate tests elsewhere in this file). */}
            <Route path={ROUTES.LOCALIZE} element={<div data-testid="localize-queue-landing" />} />
            <Route path="/classify/done/:id" element={<ClassifyDestinationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

const wrapper = makeWrapper();

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
 * "+ Add object" is gated behind the rail's missed-smoke question, which
 * starts at No on every alert (deliberately NOT seeded from the flag classify
 * set — adding an object has to be a decision made on this screen). Any test
 * that adds an object has to open that gate first.
 */
function answerMissedSmokeYes() {
  fireEvent.click(
    within(screen.getByTestId('localize-missed-smoke-row')).getByRole('radio', { name: 'Yes' })
  );
}

function makeDetectionAnnotation(detectionId: number): DetectionAnnotation {
  return {
    id: 9200 + detectionId,
    detection_id: detectionId,
    annotation: {
      annotation: [
        {
          xyxyn: [0.1, 0.1, 0.3, 0.3],
          class_name: 'smoke',
          smoke_type: 'wildfire',
          origin: 'human',
        },
      ],
    },
    processing_stage: 'annotated',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: null,
  };
}

/**
 * Puts every frame of both default lanes into the `done` cell state (an
 * annotated-stage detection annotation per detection). This is the state the
 * submit gate demands: "Submit alert" only enables once every workable object
 * already carries a committed box on every frame it appears on, so any test
 * that needs to actually reach a submit has to start from here.
 */
function mockAllFramesAccepted() {
  const detectionIdsByLane: Record<number, number[]> = { 101: [1001], 102: [1002, 1003] };
  vi.mocked(apiClient.getDetectionAnnotations).mockImplementation(async filters => {
    const items = (detectionIdsByLane[filters?.sequence_id ?? 0] ?? []).map(
      makeDetectionAnnotation
    );
    return { ...emptyAnnotationsPage, items, total: items.length };
  });
}

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
    vi.mocked(apiClient.createDetectionAnnotation).mockImplementation(async payload => ({
      id: 9100 + payload.detection_id,
      detection_id: payload.detection_id,
      annotation: payload.annotation,
      processing_stage: payload.processing_stage,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: null,
    }));
    vi.mocked(apiClient.localizeSubmit).mockResolvedValue({
      results: [
        { annotation_id: 201, sequence_id: 101, processing_stage: 'annotated' },
        { annotation_id: 202, sequence_id: 102, processing_stage: 'annotated' },
      ],
    });
    vi.mocked(apiClient.updateSequenceAnnotation).mockImplementation(async (id, updates) => ({
      ...makeAnnotation({ id, sequence_id: id === 201 ? 101 : 102 }),
      ...updates,
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

    // Each object also gets a rail row carrying its localization progress.
    expect(screen.getByTestId('localize-object-row-object-1')).toBeInTheDocument();
    expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();

    // Header badge reports progress, not just a count: neither lane has any
    // committed box yet, so nothing is localized.
    expect(screen.getByText('0 of 2 objects localized')).toBeInTheDocument();
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
    expect(screen.getAllByTestId(/^localize-object-row-/)).toHaveLength(1);
    expect(screen.getByText('0 of 1 object localized')).toBeInTheDocument();
  });

  it('no ⚑ flag row renders (retired in favor of "+ Add object")', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(screen.queryByText('⚑ Missed')).not.toBeInTheDocument();
    screen.getAllByTestId(/^object-status-row-/).forEach(row => {
      expect(row).not.toHaveAttribute('data-flag');
    });
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

  // Object 1 (lane 101) is only on T1; T2 belongs to Object 2 alone. With
  // Object 1 active, T2 is context: nothing of Object 1 to annotate there.
  it('marks frames the active object is absent from as context, and makes them non-interactive', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }));

    await waitFor(() => {
      expect(screen.getByTestId(`alert-frame-cell-${T2}`)).toHaveAttribute('data-context', 'true');
    });
    // The object's own frame stays full-strength and outlined in its color.
    const ownCell = screen.getByTestId(`alert-frame-cell-${T1}`);
    expect(ownCell).not.toHaveAttribute('data-context');
    expect(ownCell.style.outline).toContain('solid');

    // Clicking the context frame must NOT open the fallback lane's editor —
    // that used to silently switch which object you were annotating.
    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
    expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument();
  });

  it('leaves every frame interactive when no object is active', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(screen.getByTestId(`alert-frame-cell-${T2}`)).not.toHaveAttribute('data-context');

    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
    await waitFor(() => {
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003');
    });
  });

  describe('object-identity overlays in the modal', () => {
    it("opening a frame shared with another contributing lane passes that lane's boxes as a labeled object overlay (not the generic sibling layer)", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      // T1 is present in both lanes -> opening Object 1's cell there should
      // surface Object 2's box as an object-identity overlay.
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T1}`));
      await waitFor(() => {
        expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1001');
      });

      expect(screen.getByTestId('image-modal-object-overlays')).toHaveTextContent('Object 2');
    });

    it('opening a frame with no other contributing lane yields no object overlays', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      // T2 is present only in lane 102 (Object 2) -> no other lane to overlay.
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
      await waitFor(() => {
        expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003');
      });

      expect(screen.getByTestId('image-modal-object-overlays')).toHaveTextContent('');
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
    expect(screen.getByTestId('status-segment-0-0')).toHaveAttribute(
      'aria-label',
      'Object 1, frame 1: pending'
    );
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
    // — Object 1's T1 frame now reads as confirmed on the timeline, while
    // Object 2's own T1 frame is untouched.
    await waitFor(() => {
      expect(screen.getByTestId('status-segment-0-0')).toHaveAttribute(
        'aria-label',
        'Object 1, frame 1: confirmed'
      );
    });
    expect(screen.getByTestId('status-segment-1-0')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 1: pending'
    );

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

  it('a segment click gives its target cell an arrival highlight that fades after ~2s', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId('status-segment-0-0'));

      expect(screen.getByTestId(`alert-frame-cell-${T1}`)).toHaveAttribute(
        'data-highlighted',
        'true'
      );

      act(() => {
        vi.advanceTimersByTime(2000);
      });

      expect(screen.getByTestId(`alert-frame-cell-${T1}`)).not.toHaveAttribute('data-highlighted');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a ?frame=<detectionId> deep link scrolls to and highlights that frame on load, without opening the editor modal', async () => {
    // Detection 1002 (lane 102 / Object 2) is present at T1.
    await renderAndSettle(<LocalizeAlertPage />, {
      wrapper: makeWrapper('/localize/101?frame=1002'),
    });

    await waitFor(() => {
      expect(screen.getByTestId(`alert-frame-cell-${T1}`)).toHaveAttribute(
        'data-highlighted',
        'true'
      );
    });
    // The scroll happens inside a requestAnimationFrame callback, so it
    // lands a tick after the effect that resolved the `?frame=` param.
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
    expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument();

    // The resolved lane was made active, so T1 (present in both lanes) now
    // shows Object 2's detection.
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img).toHaveAttribute('src', 'https://img.example/1002.jpg');
    });
  });

  it('object-focus mode (row click) forces crop-on + small cards without clobbering the persisted card-size preference, and restores both on deselect', async () => {
    localStorage.setItem('detectionAnnotateCardSize', 'lg');

    const { container } = render(<LocalizeAlertPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('status-segment-0-0')).toBeInTheDocument());

    const grid = container.querySelector('.grid') as HTMLElement;
    expect(grid.style.gridTemplateColumns).toContain('500px'); // persisted 'lg'

    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }));

    // Focus mode: the grid is forced to small cards...
    await waitFor(() => expect(grid.style.gridTemplateColumns).toContain('240px'));
    // ...crop is applied to the now-active object's cell...
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });
    // ...the row gets the selected treatment...
    expect(screen.getByTestId('object-status-row-0')).toHaveAttribute('data-selected', 'true');
    // ...and the real persisted preference is never overwritten with 'sm'.
    expect(localStorage.getItem('detectionAnnotateCardSize')).toBe('lg');

    // Clicking the now-selected row again deselects, restoring both.
    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }));

    await waitFor(() => expect(grid.style.gridTemplateColumns).toContain('500px'));
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toBe('');
    });
    expect(screen.getByTestId('object-status-row-0')).not.toHaveAttribute('data-selected');
    expect(localStorage.getItem('detectionAnnotateCardSize')).toBe('lg');
  });

  it("switching focus to another object (segment click) keeps the ORIGINAL pre-focus settings for restore, not the most recent object's", async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });
    // Neither cropMode (default false) nor cardSize (default 'md', no
    // persisted value) has been touched yet.

    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }));
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });

    // Switch focus to Object 2 via a segment click — this must NOT re-stash
    // (Object 1's crop-on state is not the "pre-focus" value to restore).
    fireEvent.click(screen.getByTestId('status-segment-1-1'));

    await waitFor(() =>
      expect(screen.getByTestId('object-status-row-1')).toHaveAttribute('data-selected', 'true')
    );
    expect(screen.getByTestId('object-status-row-0')).not.toHaveAttribute('data-selected');

    // Deselecting Object 2 restores the ORIGINAL pre-focus crop-mode (false,
    // from before Object 1 was ever selected) — not "whatever was true a
    // moment ago".
    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 2' }));

    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toBe('');
    });
    expect(screen.getByTestId('object-status-row-1')).not.toHaveAttribute('data-selected');
  });

  it('a timeline row never shows a hover preview popover (dropped in favor of the focus-mode cropped strip)', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('object-status-row-0'));
    fireEvent.focus(screen.getByRole('button', { name: 'Go to Object 1' }));

    // Nothing appears from hover/focus alone — the strip only shows via
    // focus MODE (a click) or the manual toolbar toggle, covered below.
    expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();
  });

  it('object-focus mode shows the cropped-view strip for the focused lane, switches lanes with it, and hides it on deselect', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }));

    await waitFor(() => {
      expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
        'data-sequence-id',
        '101'
      );
    });

    // Switching focus to Object 2 (segment click) shows Object 2's strip.
    fireEvent.click(screen.getByTestId('status-segment-1-1'));

    await waitFor(() => {
      expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
        'data-sequence-id',
        '102'
      );
    });

    // Deselecting hides it.
    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 2' }));

    await waitFor(() => {
      expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();
    });
  });

  it('the manual cropped-view toolbar toggle keeps working independently when nothing is focused', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Cell click activates a lane without entering focus mode.
    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T1}`));
    await waitFor(() => {
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1001');
    });
    fireEvent.click(screen.getByText('Mock Close'));
    await waitFor(() => expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument());

    expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTitle('Cropped view'));

    await waitFor(() => {
      expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
        'data-sequence-id',
        '101'
      );
    });

    // Toggling off (not focused) is a plain toggle.
    fireEvent.click(screen.getByTitle('Cropped view'));
    await waitFor(() => {
      expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();
    });
  });

  it('while focused, the cropped-view toggle shows pressed and clicking it exits focus mode (early-exit, not a disabled dead button)', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }));
    await waitFor(() => {
      expect(screen.getByTestId('cropped-image-sequence')).toBeInTheDocument();
    });

    const croppedViewToggle = screen.getByTitle('Cropped view');
    expect(croppedViewToggle).toHaveAttribute('aria-pressed', 'true');
    expect(croppedViewToggle).not.toBeDisabled();

    fireEvent.click(croppedViewToggle);

    // Exits focus entirely: the strip hides and crop-mode is restored (was
    // off before this focus session), not just a toggle of the strip alone.
    await waitFor(() => {
      expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();
    });
    expect(screen.getByTestId('object-status-row-0')).not.toHaveAttribute('data-selected');
    const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
    expect(img.style.transform).toBe('');
  });

  it('an explicit S/M/L click while focused clears the small-card override immediately (visible + intentional preference write)', async () => {
    const { container } = render(<LocalizeAlertPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('status-segment-0-0')).toBeInTheDocument());

    const grid = container.querySelector('.grid') as HTMLElement;

    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 1' }));
    await waitFor(() => expect(grid.style.gridTemplateColumns).toContain('240px')); // forced 'sm'

    fireEvent.click(screen.getByTitle('Medium cards'));

    // Immediate visible effect — the grid honors the click right away.
    expect(grid.style.gridTemplateColumns).toContain('340px');
    // And the write was intentional: the real preference is now 'md'.
    expect(localStorage.getItem('detectionAnnotateCardSize')).toBe('md');

    // Focus otherwise continues unaffected — still selected/cropped.
    expect(screen.getByTestId('object-status-row-0')).toHaveAttribute('data-selected', 'true');
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });
  });

  describe('Submit alert', () => {
    it('stays disabled, with an explanation, while any object still has a pending frame', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      expect(screen.getByRole('button', { name: /Submit alert/ })).toBeDisabled();
      expect(screen.getByText(/Accept every object’s boxes to enable/)).toBeInTheDocument();
      expect(screen.getByText('0 of 2 objects localized')).toBeInTheDocument();
    });

    it('enables once every object is accepted, submits exactly the workable annotation ids, and navigates back to the queue', async () => {
      mockAllFramesAccepted();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Submit alert/ })).toBeEnabled()
      );
      expect(screen.getByText('2 of 2 objects localized')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Submit alert/ }));

      // Exactly one bulk submit, with both lanes' sequence-annotation ids —
      // and no accepting of its own: submit no longer writes boxes.
      await waitFor(() => {
        expect(apiClient.localizeSubmit).toHaveBeenCalledWith([201, 202]);
      });
      expect(apiClient.localizeSubmit).toHaveBeenCalledTimes(1);
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalled();

      expect(screen.getByText('Alert submitted')).toBeInTheDocument();
      await waitFor(
        () => expect(screen.getByTestId('localize-queue-landing')).toBeInTheDocument(),
        { timeout: 2000 }
      );
    });

    it('toasts and refetches statuses without navigating when the backend rejects an incomplete lane (422)', async () => {
      mockAllFramesAccepted();
      vi.mocked(apiClient.localizeSubmit).mockRejectedValue({
        detail:
          'Cannot submit: 1 detection(s) lack an annotated-stage detection annotation (localization incomplete)',
      });

      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Submit alert/ })).toBeEnabled()
      );

      const callsBefore = vi.mocked(apiClient.getDetectionAnnotations).mock.calls.length;

      fireEvent.click(screen.getByRole('button', { name: /Submit alert/ }));

      await waitFor(() => {
        expect(
          screen.getByText('Submit rejected — some frames are not yet annotated')
        ).toBeInTheDocument();
      });

      expect(screen.queryByTestId('localize-queue-landing')).not.toBeInTheDocument();

      // The lanes' detection-annotation queries were invalidated -> refetched.
      await waitFor(() => {
        expect(vi.mocked(apiClient.getDetectionAnnotations).mock.calls.length).toBeGreaterThan(
          callsBefore
        );
      });
    });

    it('is disabled when no lane is workable (both lanes already annotated)', async () => {
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
        ...makeTwoLaneAlertDetail(),
        lanes: [
          {
            sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
            annotation: makeAnnotation({
              id: 201,
              sequence_id: 101,
              processing_stage: 'annotated',
            }),
          },
          {
            sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
            annotation: makeAnnotation({
              id: 202,
              sequence_id: 102,
              processing_stage: 'annotated',
            }),
          },
        ],
      });

      render(<LocalizeAlertPage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /Submit alert/ })).toBeDisabled()
      );
    });
  });

  describe('"+ Add object"', () => {
    // Both lanes seq_annotation_done, primary-first: lane 101 is Object 1,
    // lane 102 is Object 2. `addObject` spawns a new lane appended after
    // the existing ones — it becomes Object 3 (row index 2) once
    // alert-detail refetches, mirroring the backend's real ordering
    // (next synthetic object index, highest alert_api_id).
    function mockAddObjectFlow() {
      let alertLanes: AlertLane[] = makeTwoLaneAlertDetail().lanes;
      vi.mocked(apiClient.getAlertDetail).mockImplementation(async () => ({
        ...makeTwoLaneAlertDetail(),
        lanes: alertLanes,
      }));
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101) return [makeDetection(1001, T1)];
        if (id === 102) return [makeDetection(1002, T1), makeDetection(1003, T2)];
        if (id === 103) return [makeDetection(1004, T1)];
        if (id === 104) return [makeDetection(1005, T1)];
        return [];
      });
      let nextId = 103;
      vi.mocked(apiClient.addObject).mockImplementation(
        async (_sourceApi, _platformAlertId, smokeType) => {
          const id = nextId;
          nextId += 1;
          const newLane: AlertLane = {
            sequence: makeSequence({ id, alert_api_id: 9000 + id }),
            annotation: makeAnnotation({ id: id * 10, sequence_id: id, smoke_types: [smokeType] }),
          };
          alertLanes = [...alertLanes, newLane];
          return newLane;
        }
      );
    }

    it('opens a smoke-type picker, and Cancel closes it without adding anything', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();
      fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
      expect(screen.getByRole('button', { name: 'wildfire' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'industrial' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'other' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

      expect(screen.queryByRole('button', { name: 'wildfire' })).not.toBeInTheDocument();
      expect(apiClient.addObject).not.toHaveBeenCalled();
    });

    it('picking a smoke type calls addObject with the alert identity, refetches, and the new object row appears with focus auto-entered', async () => {
      mockAddObjectFlow();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();
      fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
      fireEvent.click(screen.getByRole('button', { name: 'industrial' }));

      await waitFor(() => {
        expect(apiClient.addObject).toHaveBeenCalledWith('pyronear_french', 500, 'industrial');
      });

      // The picker closes and the new row (Object 3) appears, focused.
      await waitFor(() => {
        expect(screen.getByTestId('object-status-row-2')).toBeInTheDocument();
      });
      expect(
        within(screen.getByTestId('object-status-row-2')).getByText('Object 3')
      ).toBeInTheDocument();
      expect(screen.getByTestId('object-status-row-2')).toHaveAttribute('data-selected', 'true');
      expect(screen.queryByRole('button', { name: 'industrial' })).not.toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
          'data-sequence-id',
          '103'
        );
      });
      expect(screen.getByText('Object added')).toBeInTheDocument();
    });

    it('is repeatable: a second add spawns its own further row', async () => {
      mockAddObjectFlow();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();
      fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
      fireEvent.click(screen.getByRole('button', { name: 'wildfire' }));
      await waitFor(() => expect(screen.getByTestId('object-status-row-2')).toBeInTheDocument());

      answerMissedSmokeYes();
      fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
      fireEvent.click(screen.getByRole('button', { name: 'other' }));
      await waitFor(() => expect(screen.getByTestId('object-status-row-3')).toBeInTheDocument());

      expect(apiClient.addObject).toHaveBeenCalledTimes(2);
      expect(
        within(screen.getByTestId('object-status-row-2')).getByText('Object 3')
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId('object-status-row-3')).getByText('Object 4')
      ).toBeInTheDocument();
    });

    /**
     * Faithful to the backend's `/alert/add-object`: the spawned lane's
     * detections are cloned with `algo_predictions: []` and no
     * auto_predictions (the AI never saw this object), and every frame gets
     * a DetectionAnnotation at `bbox_annotation` stage — so every cell is
     * `no-box`, with nothing to accept until the annotator draws.
     * `mockAddObjectFlow` above is deliberately looser (its lanes carry
     * model boxes); this is the shape the real endpoint produces.
     */
    function mockRealisticAddObjectFlow() {
      let alertLanes: AlertLane[] = makeTwoLaneAlertDetail().lanes;
      vi.mocked(apiClient.getAlertDetail).mockImplementation(async () => ({
        ...makeTwoLaneAlertDetail(),
        lanes: alertLanes,
      }));
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101) return [makeDetection(1001, T1)];
        if (id === 102) return [makeDetection(1002, T1), makeDetection(1003, T2)];
        if (id === 103) {
          // Cloned frames: no predictions of any kind.
          return [
            {
              ...makeDetection(1004, T1),
              algo_predictions: { predictions: [] },
              auto_predictions: undefined,
            },
            {
              ...makeDetection(1005, T2),
              algo_predictions: { predictions: [] },
              auto_predictions: undefined,
            },
          ];
        }
        return [];
      });
      vi.mocked(apiClient.getDetectionAnnotations).mockImplementation(async filters => {
        if (filters?.sequence_id !== 103) return emptyAnnotationsPage;
        const items = [1004, 1005].map(detectionId => ({
          ...makeDetectionAnnotation(detectionId),
          annotation: { annotation: [] },
          processing_stage: 'bbox_annotation' as const,
        }));
        return { ...emptyAnnotationsPage, items, total: items.length };
      });
      vi.mocked(apiClient.addObject).mockImplementation(async () => {
        const newLane: AlertLane = {
          sequence: makeSequence({ id: 103, alert_api_id: 9003 }),
          annotation: makeAnnotation({ id: 203, sequence_id: 103 }),
        };
        alertLanes = [...alertLanes, newLane];
        return newLane;
      });
    }

    it('a just-added object reads as empty across its timeline — no fill implying boxes it does not have', async () => {
      mockRealisticAddObjectFlow();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();
      fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
      fireEvent.click(screen.getByRole('button', { name: 'wildfire' }));
      await waitFor(() => expect(screen.getByTestId('object-status-row-2')).toBeInTheDocument());

      // Both of its frames are 'empty' (present, nothing on them), NOT
      // 'pending' — which used to paint a filled bar across the whole row.
      await waitFor(() => {
        expect(screen.getByTestId('status-segment-2-0')).toHaveAttribute(
          'aria-label',
          'Object 3, frame 1: empty'
        );
      });
      expect(screen.getByTestId('status-segment-2-1')).toHaveAttribute(
        'aria-label',
        'Object 3, frame 2: empty'
      );

      // And its rail row says 0 of 2 done rather than implying progress.
      expect(
        within(screen.getByTestId('localize-object-row-object-3')).getByText('0/2')
      ).toBeInTheDocument();
    });

    it('clicking a just-added object activates it without hanging (no boxes to focus on)', async () => {
      mockRealisticAddObjectFlow();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();
      fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
      fireEvent.click(screen.getByRole('button', { name: 'wildfire' }));
      await waitFor(() => expect(screen.getByTestId('object-status-row-2')).toBeInTheDocument());

      // Row click toggles focus off (add already focused it), then on again.
      fireEvent.click(screen.getByTestId('localize-object-row-object-3'));
      fireEvent.click(screen.getByTestId('localize-object-row-object-3'));

      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-3')).toHaveAttribute(
          'data-active',
          'true'
        );
      });
      // Focus mode forces the cropped-view strip, but the lane has no boxes
      // to crop — it must simply not render rather than spin.
      expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();
    });

    it('toasts on a failed add and keeps the picker usable for a retry', async () => {
      vi.mocked(apiClient.addObject).mockRejectedValueOnce(new Error('Network error'));

      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();
      fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
      fireEvent.click(screen.getByRole('button', { name: 'wildfire' }));

      await waitFor(() => {
        expect(screen.getByText('Failed to add object — try again')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('object-status-row-2')).not.toBeInTheDocument();
    });
  });

  describe('false-positive context toggle', () => {
    /** Lane 102 classified as a false positive rather than smoke. */
    function alertWithFalsePositive() {
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
        ...makeTwoLaneAlertDetail(),
        lanes: [
          {
            sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
            annotation: makeAnnotation({ id: 201, sequence_id: 101 }),
          },
          {
            sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
            annotation: makeAnnotation({
              id: 202,
              sequence_id: 102,
              has_smoke: false,
              has_missed_smoke: false,
              smoke_types: [],
              false_positive_types: '["cloud"]',
            }),
          },
        ],
      });
    }

    it('disables the toggle when the alert has no false-positive objects', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const toggle = screen.getByRole('button', { name: /False positives/ });
      expect(toggle).toBeDisabled();
      // No count badge when there is nothing to reveal.
      expect(toggle).toHaveTextContent(/^False positives$/);
    });

    it('shows how many false-positive objects the alert has', async () => {
      alertWithFalsePositive();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const toggle = screen.getByRole('button', { name: /False positives/ });
      expect(toggle).toBeEnabled();
      expect(toggle).toHaveTextContent('False positives1');
    });

    it('keeps false-positive frames read-only — visible, never openable in the editor', async () => {
      alertWithFalsePositive();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));
      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
      });

      // Activate the false-positive object: its cropped view is the point.
      fireEvent.click(screen.getByRole('button', { name: 'Go to Object 2' }));
      await waitFor(() => {
        expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
          'data-sequence-id',
          '102'
        );
      });

      // But its frames never open the editable modal.
      expect(screen.getByTestId(`alert-frame-cell-${T2}`)).toHaveAttribute('data-readonly', 'true');
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
      expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument();
    });

    it('keeps a shared frame workable when the FIRST lane on it is the false positive', async () => {
      // Primary lane is the false positive; the smoke object is the sibling.
      // With no object active the grid falls back to a cell — it must pick
      // the workable one, or the whole frame would go read-only and hide the
      // smoke object behind an un-clickable cell.
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
        ...makeTwoLaneAlertDetail(),
        lanes: [
          {
            sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
            annotation: makeAnnotation({
              id: 201,
              sequence_id: 101,
              has_smoke: false,
              has_missed_smoke: false,
              smoke_types: [],
              false_positive_types: '["cloud"]',
            }),
          },
          {
            sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
            annotation: makeAnnotation({ id: 202, sequence_id: 102 }),
          },
        ],
      });

      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));

      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-1')).toBeInTheDocument();
      });

      // T1 carries both lanes; it stays openable, on the smoke lane.
      expect(screen.getByTestId(`alert-frame-cell-${T1}`)).not.toHaveAttribute('data-readonly');
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T1}`));
      await waitFor(() => {
        expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1002');
      });
    });

    it('hides false-positive objects by default, matching the queue rule', async () => {
      alertWithFalsePositive();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      expect(screen.getByTestId('localize-object-row-object-1')).toBeInTheDocument();
      expect(screen.queryByTestId('localize-object-row-object-2')).not.toBeInTheDocument();
      expect(screen.queryByTestId('false-positive-divider')).not.toBeInTheDocument();
    });

    it('surfaces them as a separated, read-only group when toggled on', async () => {
      alertWithFalsePositive();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));

      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
      });
      // Visually separated from the objects that still need work.
      expect(screen.getByTestId('false-positive-divider')).toBeInTheDocument();

      const fpRow = screen.getByTestId('localize-object-row-object-2');
      expect(within(fpRow).getByText('False positive')).toBeInTheDocument();
      expect(within(fpRow).getByText('cloud')).toBeInTheDocument();
      // No localization work, so no progress fraction.
      expect(within(fpRow).queryByText(/^\d+\/\d+$/)).not.toBeInTheDocument();
      // Read-only: no accept action, and it never becomes work to do.
      expect(within(fpRow).queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
      expect(screen.getByText('0 of 1 object localized')).toBeInTheDocument();
    });

    it("shows each smoke object's type on its row", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      expect(
        within(screen.getByTestId('localize-object-row-object-1')).getByText('wildfire')
      ).toBeInTheDocument();
    });
  });

  describe('missed-smoke row', () => {
    function flaggedAlert() {
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
        ...makeTwoLaneAlertDetail(),
        lanes: [
          {
            sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
            annotation: makeAnnotation({ id: 201, sequence_id: 101, has_missed_smoke: true }),
          },
          {
            sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
            annotation: makeAnnotation({ id: 202, sequence_id: 102 }),
          },
        ],
      });
    }

    it('starts at No even on an alert classify already flagged — adding an object is a decision made here', async () => {
      flaggedAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const row = screen.getByTestId('localize-missed-smoke-row');
      expect(within(row).getByRole('radio', { name: 'No' })).toHaveAttribute(
        'aria-checked',
        'true'
      );
      // And so the inherited flag alone never pre-authorizes adding.
      expect(screen.queryByRole('button', { name: 'Add object' })).not.toBeInTheDocument();
    });

    it('gates "+ Add object" until answered Yes, and re-locks it on No', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      // The control does not exist at all until the question is answered Yes.
      expect(screen.queryByRole('button', { name: 'Add object' })).not.toBeInTheDocument();

      answerMissedSmokeYes();
      expect(screen.getByRole('button', { name: 'Add object' })).toBeEnabled();
      // It lives inside the question it answers, not beside it.
      expect(
        within(screen.getByTestId('localize-missed-smoke-row')).getByRole('button', {
          name: 'Add object',
        })
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId('localize-missed-smoke-row')).getByText(
          /Add the object the AI missed/
        )
      ).toBeInTheDocument();

      // Both radios disable while the PATCH is in flight (no double-writes),
      // so wait for it to settle before answering the other way.
      const noRadio = within(screen.getByTestId('localize-missed-smoke-row')).getByRole('radio', {
        name: 'No',
      });
      await waitFor(() => expect(noRadio).toBeEnabled());
      fireEvent.click(noRadio);
      expect(screen.queryByRole('button', { name: 'Add object' })).not.toBeInTheDocument();
    });

    it('answering Yes PATCHes the flag onto the first annotated lane', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(
        within(screen.getByTestId('localize-missed-smoke-row')).getByRole('radio', { name: 'Yes' })
      );

      await waitFor(() => {
        expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledWith(201, {
          has_missed_smoke: true,
        });
      });
    });

    it('answering No clears it from whichever lane already carries it', async () => {
      flaggedAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(
        within(screen.getByTestId('localize-missed-smoke-row')).getByRole('radio', { name: 'No' })
      );

      await waitFor(() => {
        expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledWith(201, {
          has_missed_smoke: false,
        });
      });
    });

    it('answering Yes is what records the flag — the add itself no longer needs to', async () => {
      vi.mocked(apiClient.addObject).mockResolvedValue({
        sequence: makeSequence({ id: 103, alert_api_id: 9003 }),
        annotation: makeAnnotation({ id: 203, sequence_id: 103 }),
      });
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();
      fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
      fireEvent.click(screen.getByRole('button', { name: 'wildfire' }));

      await waitFor(() => {
        expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledWith(201, {
          has_missed_smoke: true,
        });
      });
    });
  });

  describe('soft-confirm on submit (flagged, no object added this session)', () => {
    // Every case here has to actually reach submit, which is gated on all
    // objects already being accepted.
    beforeEach(() => {
      mockAllFramesAccepted();
    });

    function mockFlaggedAlert() {
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
        ...makeTwoLaneAlertDetail(),
        lanes: [
          {
            sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
            annotation: makeAnnotation({ id: 201, sequence_id: 101, has_missed_smoke: true }),
          },
          {
            sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
            annotation: makeAnnotation({ id: 202, sequence_id: 102 }),
          },
        ],
      });
    }

    it('fires when a lane is flagged and no object was added this session', async () => {
      mockFlaggedAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Submit alert/ }));

      await waitFor(() => {
        expect(
          screen.getByText('You flagged missed smoke but added no object — submit anyway?')
        ).toBeInTheDocument();
      });
      expect(apiClient.localizeSubmit).not.toHaveBeenCalled();
    });

    it('adding an object this session satisfies the gate — no soft-confirm on submit', async () => {
      let alertLanes: AlertLane[] = [
        {
          sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
          annotation: makeAnnotation({ id: 201, sequence_id: 101, has_missed_smoke: true }),
        },
        {
          sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
          annotation: makeAnnotation({ id: 202, sequence_id: 102 }),
        },
      ];
      vi.mocked(apiClient.getAlertDetail).mockImplementation(async () => ({
        ...makeTwoLaneAlertDetail(),
        lanes: alertLanes,
      }));
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101) return [makeDetection(1001, T1)];
        if (id === 102) return [makeDetection(1002, T1), makeDetection(1003, T2)];
        if (id === 103) return [makeDetection(1004, T1)];
        return [];
      });
      // The spawned lane's own frame must be accepted too, or the submit
      // gate (not the soft-confirm) would be what blocks the click.
      vi.mocked(apiClient.getDetectionAnnotations).mockImplementation(async filters => {
        const byLane: Record<number, number[]> = { 101: [1001], 102: [1002, 1003], 103: [1004] };
        const items = (byLane[filters?.sequence_id ?? 0] ?? []).map(makeDetectionAnnotation);
        return { ...emptyAnnotationsPage, items, total: items.length };
      });
      vi.mocked(apiClient.addObject).mockImplementation(async () => {
        const newLane: AlertLane = {
          sequence: makeSequence({ id: 103, alert_api_id: 9003 }),
          annotation: makeAnnotation({ id: 203, sequence_id: 103 }),
        };
        alertLanes = [...alertLanes, newLane];
        return newLane;
      });

      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();
      fireEvent.click(screen.getByRole('button', { name: 'Add object' }));
      fireEvent.click(screen.getByRole('button', { name: 'wildfire' }));
      await waitFor(() => expect(screen.getByTestId('object-status-row-2')).toBeInTheDocument());

      fireEvent.click(screen.getByRole('button', { name: /Submit alert/ }));

      expect(
        screen.queryByText('You flagged missed smoke but added no object — submit anyway?')
      ).not.toBeInTheDocument();
    });

    it('"Go back" cancels — nothing is submitted or patched', async () => {
      mockFlaggedAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Submit alert/ }));

      await waitFor(() => {
        expect(
          screen.getByText('You flagged missed smoke but added no object — submit anyway?')
        ).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Go back' }));

      expect(
        screen.queryByText('You flagged missed smoke but added no object — submit anyway?')
      ).not.toBeInTheDocument();
      expect(apiClient.localizeSubmit).not.toHaveBeenCalled();
      expect(apiClient.updateSequenceAnnotation).not.toHaveBeenCalled();
    });

    it('"Submit anyway" proceeds to submit without touching the flag', async () => {
      mockFlaggedAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Submit alert/ }));
      await waitFor(() => {
        expect(screen.getByTestId('missed-smoke-confirm')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Submit anyway' }));

      await waitFor(() => {
        expect(apiClient.localizeSubmit).toHaveBeenCalledWith([201, 202]);
      });
      expect(apiClient.updateSequenceAnnotation).not.toHaveBeenCalled();
    });

    it('"Submit & clear flag" PATCHes has_missed_smoke: false on the flagged lane, then submits', async () => {
      mockFlaggedAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Submit alert/ }));
      await waitFor(() => {
        expect(screen.getByTestId('missed-smoke-confirm')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Submit & clear flag' }));

      await waitFor(() => {
        expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledWith(201, {
          has_missed_smoke: false,
        });
      });
      await waitFor(() => {
        expect(apiClient.localizeSubmit).toHaveBeenCalledWith([201, 202]);
      });
    });

    it('is the only gate left in front of submit — resolving it submits straight away', async () => {
      mockFlaggedAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Submit alert/ }));
      await waitFor(() => {
        expect(screen.getByTestId('missed-smoke-confirm')).toBeInTheDocument();
      });
      expect(apiClient.localizeSubmit).not.toHaveBeenCalled();

      // The old per-frame "N frames with no box — submit anyway?" two-step
      // went away with the bulk-accept-on-submit it guarded: submit now
      // requires every frame to already carry a committed box.
      fireEvent.click(screen.getByRole('button', { name: 'Submit anyway' }));

      await waitFor(() => {
        expect(apiClient.localizeSubmit).toHaveBeenCalledWith([201, 202]);
      });
    });
  });

  describe('reclassify', () => {
    it("navigates to the row's OWN lane in classify done mode, carrying a return to this page", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(
        within(screen.getByTestId('localize-object-row-object-2')).getByRole('button', {
          name: 'Reclassify Object 2',
        })
      );

      const destination = await screen.findByTestId('classify-destination');
      // Object 2 is lane 102 — not 101, the alert's entry sequence.
      expect(destination.getAttribute('data-lane-id')).toBe('102');
      expect(destination.getAttribute('data-return')).toBe('/localize/101');
    });

    it('offers Reclassify on an already-localized context row', async () => {
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
        ...makeTwoLaneAlertDetail(),
        lanes: [
          {
            sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
            annotation: makeAnnotation({ id: 201, sequence_id: 101 }),
          },
          {
            sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
            annotation: makeAnnotation({
              id: 202,
              sequence_id: 102,
              processing_stage: 'annotated',
            }),
          },
        ],
      });
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const contextRow = within(screen.getByTestId('localize-object-row-object-2'));
      // Context rows carry no Accept boxes action, but stay correctable.
      expect(contextRow.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
      expect(contextRow.getByRole('button', { name: 'Reclassify Object 2' })).toBeInTheDocument();
    });

    it('withholds Reclassify from false-positive context rows (FP -> smoke is issue #275)', async () => {
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
        ...makeTwoLaneAlertDetail(),
        lanes: [
          {
            sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
            annotation: makeAnnotation({ id: 201, sequence_id: 101 }),
          },
          {
            sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
            annotation: makeAnnotation({
              id: 202,
              sequence_id: 102,
              has_smoke: false,
              has_missed_smoke: false,
              smoke_types: [],
              false_positive_types: '["cloud"]',
            }),
          },
        ],
      });
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));

      const fpRow = within(await screen.findByTestId('localize-object-row-object-2'));
      expect(fpRow.queryByRole('button', { name: /Reclassify/ })).not.toBeInTheDocument();
      // The smoke row above it still has one.
      expect(
        within(screen.getByTestId('localize-object-row-object-1')).getByRole('button', {
          name: 'Reclassify Object 1',
        })
      ).toBeInTheDocument();
    });
  });

  describe('nothing left to localize', () => {
    /** Both lanes already annotated — no workable object remains. */
    function alertWithNoWorkableLane() {
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
        ...makeTwoLaneAlertDetail(),
        lanes: [
          {
            sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
            annotation: makeAnnotation({
              id: 201,
              sequence_id: 101,
              processing_stage: 'annotated',
            }),
          },
          {
            sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
            annotation: makeAnnotation({
              id: 202,
              sequence_id: 102,
              processing_stage: 'annotated',
            }),
          },
        ],
      });
    }

    it('says so under the disabled submit, instead of leaving it unexplained', async () => {
      alertWithNoWorkableLane();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      expect(screen.getByRole('button', { name: /Submit alert/ })).toBeDisabled();
      expect(screen.getByText('No objects left to localize')).toBeInTheDocument();
      // The other hint is about objects that still need accepting — not this case.
      expect(screen.queryByText(/Accept every object/)).not.toBeInTheDocument();
    });

    it('shows the accept hint, not the empty message, while work remains', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      expect(screen.getByText(/Accept every object/)).toBeInTheDocument();
      expect(screen.queryByText('No objects left to localize')).not.toBeInTheDocument();
    });
  });
});
