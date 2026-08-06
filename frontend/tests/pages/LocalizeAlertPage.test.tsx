/**
 * Tests for LocalizeAlertPage: the collocated localize screen. Task 3 scope
 * — data loading, status strip, frame grid. Task 4 adds per-frame editing
 * (cell click -> ImageModal, URL-driven via the optional :detectionId),
 * per-object quick-accept, and the S/M/L card-size + crop-zoom view
 * controls. Post-Task-5 feedback round adds the segment-click arrival
 * highlight + shareable `?frame=` deep link, and object-focus mode
 * (crop-on + small cards while an object is the timeline's selected row).
 * Task 9 retires the ⚑ pseudo-object row. The "+ Add object" control that
 * replaced it is itself retired — drawing a missed object isn't supported
 * yet, so the missed-smoke Yes answer nudges toward Skip alert instead.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  MemoryRouter,
  Routes,
  Route,
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
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
    updateSequenceAnnotation: vi.fn(),
    localizeSubmit: vi.fn(),
    addObject: vi.fn(),
    skipAlert: vi.fn(),
    materializeFrame: vi.fn(),
    unmaterializeFrame: vi.fn(),
  },
}));

vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  // Exposes sequenceId so tests can assert WHICH lane's strip is showing, and
  // accentColor so they can assert it's tied to that object's identity.
  default: (props: { sequenceId: number; accentColor?: string; showBoxes?: boolean }) => (
    <div
      data-testid="cropped-image-sequence"
      data-sequence-id={props.sequenceId}
      data-accent-color={props.accentColor}
      data-show-boxes={props.showBoxes ? 'true' : undefined}
    />
  ),
}));

/**
 * The cropped loop folds away behind a toggle in the media column's control
 * panel, offered only once an active lane has boxes. Tests that want to see it
 * open it once; the choice then persists across selections, so switching
 * objects afterwards keeps it open.
 *
 * The control's name is stable — `aria-expanded` carries open/closed — so a
 * test that cares about the direction asserts on that, not on the name.
 */
const cropToggle = () => screen.getByRole('button', { name: 'Cropped view' });

const expandCrop = async () => {
  fireEvent.click(await screen.findByRole('button', { name: 'Cropped view' }));
};

// LocalizeObjectEditor is a heavy, canvas/keyboard-driven editor covered by
// its own unit tests; here it's stubbed to a thin, inspectable stand-in so
// LocalizeAlertPage's wiring (which detection/lane it opens for, how a commit
// routes to saveDetectionReview) can be tested without exercising canvas
// drawing.
vi.mock('@/components/localize/editor', () => ({
  LocalizeObjectEditor: (props: {
    detection: Detection;
    laneSequenceId: number;
    objectLabel: string;
    laneDetections: Detection[];
    alertFrames: unknown[];
    onClose: () => void;
    onNavigateToDetection: (detectionId: number) => void;
    onCommit: (detection: Detection, items: unknown[]) => void;
    onCommitGapFrame?: (recordedAt: string, items: unknown[]) => void;
    onUnmaterialize?: (detection: Detection) => void;
    objectOverlays?: Array<{ color: string; label: string; boxes: unknown[] }>;
  }) => (
    <div data-testid="image-modal">
      <span data-testid="image-modal-detection-id">{props.detection.id}</span>
      <span data-testid="image-modal-lane-id">{props.laneSequenceId}</span>
      <span data-testid="image-modal-object-label">{props.objectLabel}</span>
      <span data-testid="image-modal-lane-frames">{props.laneDetections.length}</span>
      <span data-testid="image-modal-alert-frames">{props.alertFrames.length}</span>
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
          props.onCommit(props.detection, [
            {
              xyxyn: [0.1, 0.1, 0.2, 0.2],
              class_name: 'smoke',
              smoke_type: 'wildfire',
              origin: 'human',
            },
          ])
        }
      >
        Mock Submit
      </button>
      <button
        type="button"
        onClick={() => {
          // Mirrors the real editor's step: the next of THIS lane's frames.
          const index = props.laneDetections.findIndex(d => d.id === props.detection.id);
          const next = props.laneDetections[index + 1];
          if (next) props.onNavigateToDetection(next.id);
        }}
      >
        Mock Next
      </button>
      <button
        type="button"
        onClick={() =>
          // The alert's second frame (T2's literal value — the factory is
          // hoisted, so it cannot read the T2 const below).
          props.onCommitGapFrame?.('2026-01-01T10:05:00Z', [
            {
              xyxyn: [0.1, 0.1, 0.2, 0.2],
              class_name: 'smoke',
              smoke_type: 'wildfire',
              origin: 'human',
            },
          ])
        }
      >
        Mock Gap Draw
      </button>
      <button type="button" onClick={() => props.onUnmaterialize?.(props.detection)}>
        Mock Unmaterialize
      </button>
      <button type="button" onClick={props.onClose}>
        Mock Close
      </button>
    </div>
  ),
}));

import { apiClient } from '@/services/api';
import LocalizeAlertPage from '@/pages/LocalizeAlertPage';
import {
  ROUTES,
  localizeObjectRoute,
  localizeObjectSelect,
  localizeObjectSelectRoute,
} from '@/utils/routes';

// Lets tests assert the URL the page navigated to (which object + frame the
// editor was opened for), not just that a modal appeared.
function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location">{`${location.pathname}${location.search}`}</span>;
}

// Lets a test drive history back without window.history (MemoryRouter
// doesn't bridge it), to prove a navigation was replace, not push.
function BackProbe() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(-1)}>
      history-back-probe
    </button>
  );
}

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

/**
 * Mounts both provenances so a test can assert which one a navigation landed
 * on. The two detail routes mirror App.tsx (done declared first, so "done"
 * isn't swallowed as a sequence id), and both list routes are real elements
 * so post-submit / back navigation is observable — a mocked useNavigate would
 * also break the modal-close-on-navigate tests elsewhere in this file.
 */
function makeWrapper(initialPath = '/localize/101', priorEntries: string[] = []) {
  return function TestWrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter
          initialEntries={[...priorEntries, initialPath]}
          initialIndex={priorEntries.length}
        >
          <LocationProbe />
          <BackProbe />
          <Routes>
            {/* Mirrors App.tsx: each provenance carries the editor as a CHILD
                route so the page is never remounted when the editor opens or
                closes. The pattern comes from the shared builder the page's
                useMatch also reads, so this wrapper can't silently disagree
                with the real app. */}
            <Route path="/localize/done/:sequenceId" element={children}>
              <Route path={localizeObjectSelectRoute(true)} element={null} />
              <Route path={localizeObjectRoute(true)} element={null} />
            </Route>
            <Route path="/localize/:sequenceId" element={children}>
              <Route path={localizeObjectSelectRoute()} element={null} />
              <Route path={localizeObjectRoute()} element={null} />
            </Route>
            {/* Real routes for the landing pages so a post-submit
                `navigate(listPath)` is observable (it actually navigates,
                unlike a mocked useNavigate, which would also break the
                modal-close-on-navigate tests elsewhere in this file). */}
            <Route path={ROUTES.LOCALIZE} element={<div data-testid="localize-queue-landing" />} />
            <Route
              path={ROUTES.LOCALIZE_DONE}
              element={<div data-testid="localize-done-landing" />}
            />
            <Route path="/classify/done/:id" element={<ClassifyDestinationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
}

/** Wrapper entering the same alert from the Done list instead of the queue. */
const doneWrapper = makeWrapper('/localize/done/101');

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
 * The rail's missed-smoke question starts at No on every alert (deliberately
 * NOT seeded from the flag classify set — flagging has to be a decision made
 * on this screen). Answering Yes is what records `has_missed_smoke` and what
 * reveals the skip-alert nudge — there is no add control behind it anymore.
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
  // Any row's first strip segment — not a specific object's: a fixture whose
  // FIRST lane is a false positive settles with only later-numbered rows.
  await waitFor(() => {
    expect(screen.getAllByTestId(/^frame-segment-/).length).toBeGreaterThan(0);
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

  it('renders a rail row (with its timeline strip) and a grid cell for each object of a 2-object alert', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(
      within(screen.getByTestId('localize-object-row-object-1')).getByText('Object 1')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('localize-object-row-object-2')).getByText('Object 2')
    ).toBeInTheDocument();

    // Union of frames: T1 (both lanes) + T2 (lane 102 only) = 2 grid cells.
    expect(screen.getByTestId(`alert-frame-cell-${T1}`)).toBeInTheDocument();
    expect(screen.getByTestId(`alert-frame-cell-${T2}`)).toBeInTheDocument();

    // Both lanes are seq_annotation_done (workable) -> no context strip.
    expect(screen.queryByTestId('context-object-strip')).not.toBeInTheDocument();

    // Each row carries its own per-frame timeline strip…
    expect(screen.getByTestId('object-timeline-object-1')).toBeInTheDocument();
    expect(screen.getByTestId('object-timeline-object-2')).toBeInTheDocument();

    // …and the standalone Timeline card is gone: one object list, not two.
    expect(screen.queryByText('Timeline')).not.toBeInTheDocument();

    // Header badge reports progress, not just a count: neither lane has any
    // committed box yet, so nothing is localized.
    expect(screen.getByText('0 of 2 objects localized')).toBeInTheDocument();
  });

  // jsdom does not lay anything out, so this is a structural guard rather
  // than proof: it pins WHICH element owns the scroll, so a later refactor
  // cannot quietly return the cockpit to one page-level scroller and carry
  // the Frames panel, the cropped loop and the rail off screen with the
  // cells.
  it('scrolls the frame cells alone — the Frames panel and the rail are not inside the scroller', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    const scroller = screen.getByTestId('frame-grid-scroller');
    expect(scroller).toContainElement(screen.getByTestId(`alert-frame-cell-${T1}`));

    // The controls that act on those cells sit outside it. (The panel title
    // names the auto-selected object, so match on the prefix.)
    expect(scroller).not.toContainElement(screen.getByText(/^Frames/));
    expect(scroller).not.toContainElement(screen.getByTestId('localize-object-row-object-1'));

    // The scroller alone proves nothing: an overflow container inside an
    // unbounded column just grows instead of scrolling. What makes the grid
    // the ONLY scroller is the bounded ancestor chain — a fixed-height root,
    // and `min-h-0` on every flex column between it and the cells, without
    // which `min-height: auto` lets the cells push the whole page taller.
    expect(scroller.className).toContain('lg:min-h-0');
    const column = scroller.parentElement as HTMLElement;
    expect(column.className).toContain('lg:min-h-0');
    expect(column.className).toContain('lg:flex-col');
    expect((column.parentElement as HTMLElement).className).toContain('lg:h-[calc(100vh-3rem)]');
  });

  it('clicking a row header activates that object (the shared frame now shows its detection)', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Before activation: T1's cell falls back to the first lane present (Object 1 / detection 1001).
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img).toHaveAttribute('src', 'https://img.example/1001.jpg');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));

    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img).toHaveAttribute('src', 'https://img.example/1002.jpg');
    });
  });

  it('clicking a segment activates its object and scrolls the grid to that frame', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Object 2's row (index 1) has segments for both T1 and T2; frame index 1 is T2.
    fireEvent.click(screen.getByTestId('frame-segment-object-2-1'));

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

    expect(screen.getAllByTestId(/^localize-object-row-/)).toHaveLength(1);
    expect(screen.getAllByTestId(/^object-timeline-/)).toHaveLength(1);
    expect(screen.getByText('0 of 1 object localized')).toBeInTheDocument();
  });

  it('no ⚑ flag row renders', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(screen.queryByText('⚑ Missed')).not.toBeInTheDocument();
    screen.getAllByTestId(/^localize-object-row-/).forEach(row => {
      expect(row).not.toHaveAttribute('data-flag');
    });
  });

  it('clicking a grid cell opens the editor WITHOUT entering focus mode', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Arrival auto-focused Object 1 — exit focus first (second row click)
    // so the unfocused-active state this test pins is actually in play.
    fireEvent.click(screen.getByRole('button', { name: 'Object 1' }));
    await waitFor(() =>
      expect(screen.getByTestId('localize-object-row-object-1')).not.toHaveAttribute('data-active')
    );

    // Object 1 (lane 101) is still active; T1 shows its detection.
    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T1}`));

    await waitFor(() => {
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1001');
    });

    fireEvent.click(screen.getByText('Mock Close'));
    await waitFor(() => expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument());

    // Active, but NOT focused: the editor URL carries the lane (no
    // `activateFocus`), because opening the editor shouldn't also flip the
    // background grid into crop-on + small cards behind the modal. Nothing
    // else pins that distinction for the click path — the pasted-URL path
    // has its own test — so unifying the two activation helpers would
    // otherwise pass CI.
    expect(screen.getByTestId('localize-object-row-object-1')).not.toHaveAttribute('data-active');
    expect(
      within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img').style.transform
    ).toBe('');
  });

  it('clicking a grid cell navigates to the editor URL naming the object and the frame', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // T2 is present only in lane 102 (Object 2 / detection 1003) — its cell
    // is only interactive while that object is active, so select it first.
    fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102/1003');
    });
    expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003');
  });

  it('opens the editor from a directly-entered object URL', async () => {
    await renderAndSettle(<LocalizeAlertPage />, {
      wrapper: makeWrapper('/localize/101/object/102/1003'),
    });

    await waitFor(() => {
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003');
    });
  });

  it('makes the URL-named object active in the cockpit behind a directly-entered editor URL', async () => {
    // Arriving by paste / refresh / back button, not by the click that would
    // otherwise have set the active object. T1 is present in both lanes, so
    // the cell image proves which lane the cockpit considers active.
    await renderAndSettle(<LocalizeAlertPage />, {
      wrapper: makeWrapper('/localize/101/object/102/1002'),
    });

    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img).toHaveAttribute('src', 'https://img.example/1002.jpg');
    });
    // Active, but NOT focused: focus mode forces crop-on + small cards, and
    // a pasted link shouldn't silently change how the grid is rendered. Same
    // rule the `?frame=` deep link follows.
    expect(screen.getByTestId('localize-object-row-object-2')).not.toHaveAttribute('data-active');
  });

  it('leaves the editor closed when the frame belongs to a different object than the URL names', async () => {
    // Detection 1001 belongs to lane 101, but the URL claims lane 102. Under
    // the old frame-only route this silently edited whichever lane owned the
    // detection; now the two facts can disagree, and disagreement wins.
    await renderAndSettle(<LocalizeAlertPage />, {
      wrapper: makeWrapper('/localize/101/object/102/1001'),
    });

    expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument();
  });

  it('leaves the editor closed when the URL names a lane that is not part of this alert', async () => {
    await renderAndSettle(<LocalizeAlertPage />, {
      wrapper: makeWrapper('/localize/101/object/999/1001'),
    });

    expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument();
  });

  it('keeps the object segment in the URL when stepping to the next frame', async () => {
    // Lane 102 has two frames (1002 at T1, 1003 at T2), so prev/next has
    // somewhere to go within the object's own lane.
    await renderAndSettle(<LocalizeAlertPage />, {
      wrapper: makeWrapper('/localize/101/object/102/1002'),
    });
    await waitFor(() => {
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1002');
    });

    fireEvent.click(screen.getByText('Mock Next'));

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102/1003');
    });
  });

  it('does not remount the page when the editor opens and closes', async () => {
    // The editor is a child route precisely so cockpit state survives. Focus
    // mode (crop on + small cards) is the visible proof: a remount would
    // reset the grid to the persisted card size.
    localStorage.setItem('detectionAnnotateCardSize', 'lg');
    const { container } = render(<LocalizeAlertPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('frame-segment-object-1-0')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
    const grid = container.querySelector('.grid') as HTMLElement;
    await waitFor(() => expect(grid.style.gridTemplateColumns).toContain('240px'));

    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
    await waitFor(() => expect(screen.getByTestId('image-modal')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Mock Close'));
    await waitFor(() => expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument());

    // Still focused, still small cards — the page was never remounted.
    expect(screen.getByTestId('localize-object-row-object-2')).toHaveAttribute('data-active', 'true');
    expect((container.querySelector('.grid') as HTMLElement).style.gridTemplateColumns).toContain(
      '240px'
    );
  });

  it("clicking a grid cell opens the ACTIVE object's detection at that frame when the active lane is present there", async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
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

    fireEvent.click(screen.getByRole('button', { name: 'Object 1' }));

    await waitFor(() => {
      expect(screen.getByTestId(`alert-frame-cell-${T2}`)).toHaveAttribute('data-context', 'true');
    });
    // The object's own frame stays full-strength — the contrast against the
    // dimmed context frames is the whole signal; no border is drawn.
    const ownCell = screen.getByTestId(`alert-frame-cell-${T1}`);
    expect(ownCell).not.toHaveAttribute('data-context');
    expect(ownCell.style.outline).toBe('');

    // Clicking the context frame must NOT open the fallback lane's editor —
    // that used to silently switch which object you were annotating.
    fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
    expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument();
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

      // T2 is present only in lane 102 (Object 2) -> no other lane to
      // overlay. Its cell needs Object 2 active to be interactive.
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
      await waitFor(() => {
        expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003');
      });

      expect(screen.getByTestId('image-modal-object-overlays')).toHaveTextContent('');
    });
  });

  it('saving a frame in the editor creates the annotation via saveDetectionReview, keeps the editor open, and redraws the grid status', async () => {
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
    expect(screen.getByTestId('frame-segment-object-1-0')).toHaveAttribute(
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

    // Every editor action autosaves, so a save leaves the editor open on the
    // same frame — there is no submit-and-close step any more, and no success
    // toast to go with one. The annotator keeps working; Esc closes.
    expect(screen.getByTestId('image-modal')).toBeInTheDocument();
    expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1001');

    // Only lane 101's detection-annotations query was invalidated/refetched
    // — Object 1's T1 frame now reads as confirmed on the timeline, while
    // Object 2's own T1 frame is untouched.
    await waitFor(() => {
      expect(screen.getByTestId('frame-segment-object-1-0')).toHaveAttribute(
        'aria-label',
        'Object 1, frame 1: confirmed'
      );
    });
    expect(screen.getByTestId('frame-segment-object-2-0')).toHaveAttribute(
      'aria-label',
      'Object 2, frame 1: pending'
    );

    expect(screen.queryByText('Frame saved')).not.toBeInTheDocument();
  });

  it('hands the editor the object named in the URL, not just the frame', async () => {
    await renderAndSettle(<LocalizeAlertPage />, {
      wrapper: makeWrapper(`${ROUTES.LOCALIZE}/101/object/101/1001`),
    });

    await waitFor(() => {
      expect(screen.getByTestId('image-modal-lane-id')).toHaveTextContent('101');
    });
    expect(screen.getByTestId('image-modal-object-label')).toHaveTextContent('Object 1');
    expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1001');
  });

  it('hands the editor the whole alert frame range, so it can show out-of-object frames', async () => {
    await renderAndSettle(<LocalizeAlertPage />, {
      wrapper: makeWrapper(`${ROUTES.LOCALIZE}/101/object/101/1001`),
    });

    await waitFor(() => {
      expect(screen.getByTestId('image-modal')).toBeInTheDocument();
    });
    // The lane's own detections are a subset of the alert's frames; the page
    // must pass the alert-wide model, not the lane's.
    expect(Number(screen.getByTestId('image-modal-alert-frames').textContent)).toBeGreaterThanOrEqual(
      Number(screen.getByTestId('image-modal-lane-frames').textContent)
    );
  });

  it('the S/M/L card-size control resizes the grid and persists to the key shared with the legacy page', async () => {
    const { container } = render(<LocalizeAlertPage />, { wrapper: wrapper });
    await waitFor(() => expect(screen.getByTestId('frame-segment-object-1-0')).toBeInTheDocument());

    const grid = container.querySelector('.grid') as HTMLElement;
    // Arrival auto-focus forces small cards (the preference stays 'md').
    expect(grid.style.gridTemplateColumns).toContain('240px');

    // An explicit size click while focused both writes the preference and
    // takes visible effect immediately.
    fireEvent.click(screen.getByTitle('Large cards'));

    expect(grid.style.gridTemplateColumns).toContain('500px');
    expect(localStorage.getItem('detectionAnnotateCardSize')).toBe('lg');
  });

  it('crop mode zooms grid cells around the active object\'s boxes (toolbar + "c" shortcut)', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Arrival auto-focus already turned crop on around Object 1's boxes.
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });

    // The 'c' shortcut toggles it off…
    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toBe('');
    });

    // …and the toolbar button turns it back on.
    fireEvent.click(screen.getByTitle('Crop cells (C)'));
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });
  });

  it('crop mode zooms a gap frame (active lane present, no boxes) to the nearest boxed neighbors', async () => {
    // Lane 101 gains a boxless detection at T2 (no predictions -> 'empty'
    // cell state), making T2 a gap frame for Object 1.
    vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
      if (id === 101)
        return [
          makeDetection(1001, T1),
          { ...makeDetection(1004, T2), auto_predictions: { predictions: [] } },
        ];
      if (id === 102) return [makeDetection(1002, T1), makeDetection(1003, T2)];
      return [];
    });

    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Arrival auto-focus: Object 1 active, crop on. T2 has none of its boxes,
    // so it borrows T1's box region (0.1–0.3 -> scale 4 about 20% 20%).
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T2}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
      expect(img.style.transformOrigin).toBe('20% 20%');
    });
    // A gap frame is the object's own (clickable) cell, not context.
    expect(screen.getByTestId(`alert-frame-cell-${T2}`)).not.toHaveAttribute('data-context');
  });

  it('crop mode zooms context frames to the borrowed region and lightens their fade', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Arrival auto-focus: Object 1 (lane 101, present only at T1) active,
    // crop on. T2 is context — zoomed to T1's borrowed region, not full-frame.
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T2}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });
    const cell = screen.getByTestId(`alert-frame-cell-${T2}`);
    expect(cell).toHaveAttribute('data-context', 'true');
    // The heavy fade would bury faint smoke in the zoomed region: crop mode
    // swaps it for a subtle dim.
    expect(cell.className).toContain('opacity-75');
    expect(cell.className).not.toContain('opacity-40');

    // Crop off: back to full-frame and the strong fade.
    fireEvent.keyDown(window, { key: 'c' });
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T2}`)).getByRole('img');
      expect(img.style.transform).toBe('');
    });
    expect(cell.className).toContain('opacity-40');
    expect(cell.className).toContain('saturate-50');
  });

  it('a segment click gives its target cell an arrival highlight that fades after ~2s', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByTestId('frame-segment-object-1-0'));

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

    // The arrival auto-select yielded to the deep link: the frame's own lane
    // is the one the URL now names, and it is active WITHOUT focus mode — a
    // reload reproducing "where you were looking" must not force crop-on.
    expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102');
    expect(screen.getByTestId('localize-object-row-object-2')).not.toHaveAttribute('data-active');
    expect(
      within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img').style.transform
    ).toBe('');
  });

  it('object-focus mode (the arrival auto-focus) forces crop-on + small cards without clobbering the persisted card-size preference, and restores both on deselect', async () => {
    localStorage.setItem('detectionAnnotateCardSize', 'lg');

    const { container } = render(<LocalizeAlertPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('frame-segment-object-1-0')).toBeInTheDocument());

    const grid = container.querySelector('.grid') as HTMLElement;

    // Arrival auto-focus: the grid is forced to small cards...
    await waitFor(() => expect(grid.style.gridTemplateColumns).toContain('240px'));
    // ...crop is applied to the now-active object's cell...
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });
    // ...the row gets the selected treatment...
    expect(screen.getByTestId('localize-object-row-object-1')).toHaveAttribute('data-active', 'true');
    // ...and the real persisted preference is never overwritten with 'sm'.
    expect(localStorage.getItem('detectionAnnotateCardSize')).toBe('lg');

    // Clicking the now-selected row again deselects, restoring both.
    fireEvent.click(screen.getByRole('button', { name: 'Object 1' }));

    await waitFor(() => expect(grid.style.gridTemplateColumns).toContain('500px'));
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toBe('');
    });
    expect(screen.getByTestId('localize-object-row-object-1')).not.toHaveAttribute('data-active');
    expect(localStorage.getItem('detectionAnnotateCardSize')).toBe('lg');
  });

  it("switching focus to another object (segment click) keeps the ORIGINAL pre-focus settings for restore, not the most recent object's", async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });
    // Arrival auto-focus stashed the true pre-focus state (crop off, card
    // size 'md' — nothing had been touched before the redirect landed).
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });

    // Switch focus to Object 2 via a segment click — this must NOT re-stash
    // (Object 1's crop-on state is not the "pre-focus" value to restore).
    fireEvent.click(screen.getByTestId('frame-segment-object-2-1'));

    await waitFor(() =>
      expect(screen.getByTestId('localize-object-row-object-2')).toHaveAttribute('data-active', 'true')
    );
    expect(screen.getByTestId('localize-object-row-object-1')).not.toHaveAttribute('data-active');

    // Deselecting Object 2 restores the ORIGINAL pre-focus crop-mode (false,
    // from before Object 1 was ever selected) — not "whatever was true a
    // moment ago".
    fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));

    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toBe('');
    });
    expect(screen.getByTestId('localize-object-row-object-2')).not.toHaveAttribute('data-active');
  });

  it('a rail row never shows a hover preview popover (dropped in favor of the focus-mode cropped strip)', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId('localize-object-row-object-1'));
    fireEvent.focus(screen.getByRole('button', { name: 'Object 1' }));

    // Nothing appears from hover/focus alone — the strip needs an actually
    // ACTIVE lane (a click), covered below.
    expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();
  });

  it("the active row's disclosure shows that lane's cropped strip, stays open across a lane switch, and persists after exiting focus", async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Arrival auto-focus already selected Object 1 — but selection alone
    // doesn't unfold the strip, the disclosure control does.
    await waitFor(() => {
      expect(screen.getByTestId('localize-object-row-object-1')).toHaveAttribute('data-active');
    });
    expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();

    await expandCrop();

    await waitFor(() => {
      expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
        'data-sequence-id',
        '101'
      );
      // Localize opts in to the winner-box overlay on the loop.
      expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
        'data-show-boxes',
        'true'
      );
    });

    // Switching focus to Object 2 (segment click) carries the open disclosure
    // over and shows Object 2's strip — no second click to re-open it.
    fireEvent.click(screen.getByTestId('frame-segment-object-2-1'));

    await waitFor(() => {
      expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
        'data-sequence-id',
        '102'
      );
    });

    // A second click on the focused row exits focus but keeps the object
    // active (selection lives in the URL now), so the strip stays with it.
    fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));

    await waitFor(() => {
      expect(screen.getByTestId('localize-object-row-object-2')).not.toHaveAttribute('data-active');
    });
    expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
      'data-sequence-id',
      '102'
    );
  });

  // The disclosure is a real toggle, not a one-way reveal: the page holds the
  // flag, so the second click has to travel back through it.
  it('collapses the loop again on a second click of the disclosure', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Arrival auto-focus already selected Object 1.
    await expandCrop();
    await waitFor(() => {
      expect(screen.getByTestId('cropped-image-sequence')).toBeInTheDocument();
    });

    expect(cropToggle()).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(cropToggle());

    await waitFor(() => {
      expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();
    });
    // The row stays selected — collapsing the loop is not deselecting.
    expect(screen.getByTestId('localize-object-row-object-1')).toHaveAttribute('data-active');
  });

  // The disclosure sits in the media panel and follows `activeLaneId`, like
  // the actions beside it — NOT focus mode. Closing the frame editor leaves a
  // lane active without re-entering focus, and that is exactly when someone is
  // most obviously working one object, so the loop stays reachable there.
  // The strip carries the object's overlay colour, the same tie-to-identity
  // classify's media panel makes — with several objects in an alert, an
  // uncoloured crop is ambiguous about whose plume it is.
  it('tints the strip with the active object accent colour', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    fireEvent.click(screen.getByRole('button', { name: 'Object 1' }));
    await expandCrop();

    await waitFor(() => {
      const strip = screen.getByTestId('cropped-image-sequence');
      expect(strip).toHaveAttribute('data-sequence-id', '101');
      expect(strip.getAttribute('data-accent-color')).toBeTruthy();
    });
  });

  it('exiting focus restores the pre-focus crop mode while the object stays active', async () => {
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    // Arrival auto-focus selected Object 1; open its cropped loop.
    await expandCrop();
    await waitFor(() => {
      expect(screen.getByTestId('cropped-image-sequence')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Object 1' }));

    await waitFor(() => {
      expect(screen.getByTestId('localize-object-row-object-1')).not.toHaveAttribute('data-active');
    });
    // Crop-mode was off before this focus session, so the cells go back to
    // untransformed images…
    const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
    expect(img.style.transform).toBe('');
    // …but the object is still active, so its cropped loop stays available.
    expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
      'data-sequence-id',
      '101'
    );
  });

  it('an explicit S/M/L click while focused clears the small-card override immediately (visible + intentional preference write)', async () => {
    const { container } = render(<LocalizeAlertPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('frame-segment-object-1-0')).toBeInTheDocument());

    const grid = container.querySelector('.grid') as HTMLElement;

    // Arrival auto-focus forces 'sm'.
    await waitFor(() => expect(grid.style.gridTemplateColumns).toContain('240px'));

    fireEvent.click(screen.getByTitle('Medium cards'));

    // Immediate visible effect — the grid honors the click right away.
    expect(grid.style.gridTemplateColumns).toContain('340px');
    // And the write was intentional: the real preference is now 'md'.
    expect(localStorage.getItem('detectionAnnotateCardSize')).toBe('md');

    // Focus otherwise continues unaffected — still selected/cropped.
    expect(screen.getByTestId('localize-object-row-object-1')).toHaveAttribute('data-active', 'true');
    await waitFor(() => {
      const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
      expect(img.style.transform).toContain('scale(');
    });
  });

  describe('Submit alert', () => {
    it('stays disabled, with an explanation, while any object still has a pending frame', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const submit = screen.getByRole('button', { name: /Submit/ });
      expect(submit).toBeDisabled();

      // The explanation lives in the button's tooltip now, and counts the
      // objects holding submit back rather than restating the rule. Scoped
      // through aria-describedby — the auto-selected object's own actions
      // carry tooltips of their own, so a bare role query is ambiguous.
      const tip = document.getElementById(submit.getAttribute('aria-describedby')!)!;
      expect(tip).toHaveTextContent('2 objects still have frames without a box');

      expect(screen.getByText('0 of 2 objects localized')).toBeInTheDocument();
    });

    it('switches the tooltip to what submit will do once every object is accepted', async () => {
      mockAllFramesAccepted();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const submit = screen.getByRole('button', { name: /Submit/ });
      await waitFor(() => expect(submit).toBeEnabled());
      const tip = document.getElementById(submit.getAttribute('aria-describedby')!)!;
      expect(tip).toHaveTextContent('Submits every object still awaiting localization');
    });

    it('blocks submit and explains why while a sibling object is still undecided', async () => {
      // The queue hides such an alert; this covers a deep link or a stale
      // tab, and mirrors the server guard on localize-submit (spec:
      // 2026-08-05 unsure lanes gate the localize queue).
      const detail = makeTwoLaneAlertDetail();
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue({
        ...detail,
        lanes: [
          ...detail.lanes,
          {
            sequence: makeSequence({ id: 103, alert_api_id: 9003 }),
            annotation: makeAnnotation({
              id: 203,
              sequence_id: 103,
              is_unsure: true,
              has_smoke: false,
              processing_stage: 'seq_annotation_done',
            }),
          },
        ],
      });
      mockAllFramesAccepted();

      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      // Every workable object is boxed, so only the undecided sibling can be
      // holding submit back.
      await waitFor(() =>
        expect(screen.getByText('2 of 2 objects localized')).toBeInTheDocument()
      );
      expect(screen.getByTestId('undecided-lanes-banner')).toBeInTheDocument();

      const submit = screen.getByRole('button', { name: /Submit/ });
      expect(submit).toBeDisabled();
      fireEvent.click(submit);
      expect(apiClient.localizeSubmit).not.toHaveBeenCalled();
    });

    it('enables once every object is accepted, submits exactly the workable annotation ids, and navigates back to the queue', async () => {
      mockAllFramesAccepted();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      await waitFor(() => expect(screen.getByRole('button', { name: /Submit/ })).toBeEnabled());
      expect(screen.getByText('2 of 2 objects localized')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

      // Exactly one bulk submit, with both lanes' sequence-annotation ids —
      // and no accepting of its own: submit no longer writes boxes.
      await waitFor(() => {
        expect(apiClient.localizeSubmit).toHaveBeenCalledWith([201, 202]);
      });
      expect(apiClient.localizeSubmit).toHaveBeenCalledTimes(1);
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalled();

      expect(screen.getByText('Objects submitted')).toBeInTheDocument();
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
      await waitFor(() => expect(screen.getByRole('button', { name: /Submit/ })).toBeEnabled());

      const callsBefore = vi.mocked(apiClient.getDetectionAnnotations).mock.calls.length;

      fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

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
      // Nothing to submit: the rail says the alert is finished rather than
      // offering a dead button under "accept every object's boxes".
      await waitFor(() => expect(screen.getByTestId('all-objects-localized')).toBeInTheDocument());
      expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument();
    });
  });

  // /localize/done/:sequenceId used to mount the legacy per-lane page, which
  // showed ONLY the alert's first lane. It now mounts this same collocated
  // component with mode="done" — provenance is the only difference.
  describe('done provenance (entered from the Done list)', () => {
    it('shows every object of the alert, not just the entry lane', async () => {
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      expect(
        within(screen.getByTestId('localize-object-row-object-1')).getByText('Object 1')
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId('localize-object-row-object-2')).getByText('Object 2')
      ).toBeInTheDocument();
      expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
    });

    it('counts already-localized objects in the progress badge, not "0 of 0"', async () => {
      // Every lane past localization: nothing is workable, but both objects
      // ARE localized — the badge must say so rather than collapsing to zero.
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
      mockAllFramesAccepted();

      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      expect(screen.getByText('2 of 2 objects localized')).toBeInTheDocument();
      // Nothing workable left: a finished alert reads as finished, not as a
      // blocked action under "accept every object's boxes".
      expect(screen.getByTestId('all-objects-localized')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Submit/ })).not.toBeInTheDocument();
      // And its rows are the subject of the page, not dimmed-out context.
      expect(screen.getByTestId('localize-object-row-object-1')).not.toHaveAttribute('data-dimmed');
    });

    it('returns to the Done list, not the queue', async () => {
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));

      await waitFor(() => {
        expect(screen.getByTestId('localize-done-landing')).toBeInTheDocument();
      });
      expect(screen.queryByTestId('localize-queue-landing')).not.toBeInTheDocument();
    });

    it('keeps the editor on the done route when opening, stepping and closing a frame', async () => {
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      // Opening a frame must not silently move the session onto the queue
      // route — the whole page is mounted from the path. T2's cell needs
      // Object 2 active to be interactive (auto-select landed on Object 1).
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
      await waitFor(() => {
        expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003');
      });
      expect(screen.queryByTestId('localize-queue-landing')).not.toBeInTheDocument();

      fireEvent.click(screen.getByText('Mock Close'));
      await waitFor(() => expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument());
      // Still on the alert, still under /localize/done.
      expect(screen.getByTestId(`alert-frame-cell-${T2}`)).toBeInTheDocument();
      expect(screen.queryByTestId('localize-queue-landing')).not.toBeInTheDocument();
    });

    it('opens the editor under the Done prefix, object segment and all', async () => {
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      // T2 is present only in lane 102 (Object 2 / detection 1003); select
      // its object first so the cell is interactive.
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));

      await waitFor(() => {
        expect(screen.getByTestId('location')).toHaveTextContent(
          '/localize/done/101/object/102/1003'
        );
      });
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003');
    });

    it('opens from a directly-entered Done editor URL, and steps frames without losing the prefix', async () => {
      await renderAndSettle(<LocalizeAlertPage mode="done" />, {
        wrapper: makeWrapper('/localize/done/101/object/102/1002'),
      });
      await waitFor(() => {
        expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1002');
      });

      fireEvent.click(screen.getByText('Mock Next'));

      await waitFor(() => {
        expect(screen.getByTestId('location')).toHaveTextContent(
          '/localize/done/101/object/102/1003'
        );
      });
    });

    it('still edits frames — a save routes through saveDetectionReview as in queue mode', async () => {
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
      await waitFor(() => {
        expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003');
      });

      fireEvent.click(screen.getByText('Mock Submit'));

      await waitFor(() => {
        expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith(
          expect.objectContaining({ detection_id: 1003, processing_stage: 'annotated' })
        );
      });
    });

    it('returns to the Done list after submitting', async () => {
      mockAllFramesAccepted();
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      await waitFor(() => expect(screen.getByRole('button', { name: /Submit/ })).toBeEnabled());
      fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

      await waitFor(() => expect(apiClient.localizeSubmit).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByTestId('localize-done-landing')).toBeInTheDocument(), {
        timeout: 2000,
      });
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

    /**
     * Production-shaped false-positive lane, which `alertWithFalsePositive`
     * above is NOT: a real FP lane carries an `annotated` detection
     * annotation with an EMPTY box list (the backend writes
     * `{"annotation": []}` when the human answers "no smoke here") and keeps
     * the object's real location in `algo_predictions`. The default
     * `makeDetection` fixture has an empty engine track and a populated
     * `auto_predictions`, which is the reverse — so tests about what an FP
     * lane displays must build their own detections.
     */
    function realisticFalsePositiveAlert() {
      alertWithFalsePositive();
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101) return [makeDetection(1001, T1)];
        if (id === 102) {
          return [makeDetection(1002, T1), makeDetection(1003, T2)].map(d => ({
            ...d,
            algo_predictions: {
              predictions: [
                {
                  xyxyn: [0.5, 0.5, 0.7, 0.7] as [number, number, number, number],
                  confidence: 0.8,
                  class_name: 'smoke',
                },
              ],
            },
            auto_predictions: null,
          }));
        }
        return [];
      });
      vi.mocked(apiClient.getDetectionAnnotations).mockImplementation(async filters => {
        if (filters?.sequence_id !== 102) return emptyAnnotationsPage;
        const items = [1002, 1003].map(detectionId => ({
          ...makeDetectionAnnotation(detectionId),
          annotation: { annotation: [] },
        }));
        return { ...emptyAnnotationsPage, items, total: items.length };
      });
    }

    it('draws the engine track for a false-positive object, dashed as uncommitted context', async () => {
      realisticFalsePositiveAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));
      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
      });

      // The grid only paints box overlays once it has measured the rendered
      // image, and jsdom never fires `load` on its own — so drive it here.
      const frameImage = await within(screen.getByTestId(`alert-frame-cell-${T2}`)).findByRole(
        'img'
      );
      fireEvent.load(frameImage);

      const fpBox = await screen.findByTestId(`alert-frame-box-${T2}-102`);
      // Dashed, not solid: nothing here is committed — it's where the engine
      // thought the object was, kept for "is that plume already accounted
      // for?" context.
      expect(fpBox.getAttribute('style')).toContain('dashed');
    });

    it('gives a false-positive object a present timeline, not an empty one', async () => {
      realisticFalsePositiveAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));
      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
      });

      // Object 2's first segment covers T1, where the engine track puts a
      // box. The row's strip exposes a segment's status only through its
      // aria-label.
      expect(screen.getByTestId('frame-segment-object-2-0')).toHaveAttribute(
        'aria-label',
        'Object 2, frame 1: confirmed'
      );
    });

    it('shows the cropped flipbook for an activated false-positive object', async () => {
      realisticFalsePositiveAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));
      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      await expandCrop();

      // Looking closely at the rejected plume is the entire point of the
      // read-only FP view — the flipbook is gated on the lane having boxes,
      // which its empty committed annotation never provided. An FP row has no
      // Accept-boxes action, so this also covers the disclosure appearing on a
      // row whose only action it is.
      await waitFor(() => {
        expect(screen.getByTestId('cropped-image-sequence')).toHaveAttribute(
          'data-sequence-id',
          '102'
        );
      });
    });

    it("does not outline an activated false-positive object's frames", async () => {
      realisticFalsePositiveAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));
      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));

      // The full-cell accent outline says "this object is here, work on it".
      // A false positive is settled and its cells are read-only — the dashed
      // box already marks where it is.
      await waitFor(() => {
        expect(screen.getByTestId(`alert-frame-cell-${T2}`)).toHaveAttribute(
          'data-readonly',
          'true'
        );
      });
      expect(
        screen.getByTestId(`alert-frame-cell-${T2}`).getAttribute('style') ?? ''
      ).not.toContain('outline');
    });

    // The per-cell accent outline was dropped entirely: object identity
    // colors include blue, which read as stray chrome around the frames.
    // The contrast against dimmed context cells already says which frames
    // belong to the active object.
    it("draws no accent outline on an activated object's frames", async () => {
      realisticFalsePositiveAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: 'Object 1' }));

      await waitFor(() => {
        expect(screen.getByTestId(`alert-frame-cell-${T1}`)).not.toHaveAttribute('data-context');
      });
      expect(
        screen.getByTestId(`alert-frame-cell-${T1}`).getAttribute('style') ?? ''
      ).not.toContain('outline');
    });

    it('deselects a false-positive object when the toggle hides it again', async () => {
      realisticFalsePositiveAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));
      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
      });
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      await expandCrop();
      await waitFor(() => {
        expect(screen.getByTestId('cropped-image-sequence')).toBeInTheDocument();
      });

      // Hiding false positives again while one is the active object used to
      // strand `activeLaneId` on a lane the model no longer contains: every
      // remaining cell then read as "not this object's frame", so the whole
      // grid went dimmed and unclickable with no way back except clicking a
      // row.
      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));
      await waitFor(() => {
        expect(screen.queryByTestId('localize-object-row-object-2')).not.toBeInTheDocument();
      });

      const cell = screen.getByTestId(`alert-frame-cell-${T1}`);
      expect(cell).not.toHaveAttribute('data-context');
      expect(cell).not.toHaveAttribute('data-readonly');
      fireEvent.click(cell);
      await waitFor(() => {
        expect(screen.getByTestId('image-modal')).toBeInTheDocument();
      });
    });

    it('disables the toggle when the alert has no false-positive objects', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const toggle = screen.getByRole('button', { name: /False positives/ });
      expect(toggle).toBeDisabled();
      // No count badge when there is nothing to reveal.
      expect(toggle).toHaveTextContent(/^FP$/);
    });

    it('shows how many false-positive objects the alert has', async () => {
      alertWithFalsePositive();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const toggle = screen.getByRole('button', { name: /False positives/ });
      expect(toggle).toBeEnabled();
      expect(toggle).toHaveTextContent('FP1');
    });

    it('the FP toggle keeps its full name for screen readers and explains itself in a tooltip', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      // Default fixture has no FP lanes, so the disabled-state copy shows.
      const toggle = screen.getByRole('button', { name: 'False positives' });
      const tipId = toggle.getAttribute('aria-describedby');
      expect(tipId).toBeTruthy();
      expect(document.getElementById(tipId!)).toHaveTextContent(
        'This alert has no false-positive objects'
      );
      expect(toggle).not.toHaveAttribute('title');
    });

    it('keeps false-positive frames read-only — visible, never openable in the editor', async () => {
      realisticFalsePositiveAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));
      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
      });

      // Activate the false-positive object: its cropped view is the point.
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      await expandCrop();
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

    it('refuses a pasted editor URL naming a false-positive object', async () => {
      // The grid already refuses to open these frames; this closes the
      // pasted / back-button route in as well.
      alertWithFalsePositive();
      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper('/localize/101/object/102/1003'),
      });

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
      // Read-only: no accept action, and it never becomes work to do. Asserted
      // with the row SELECTED — unselected rows show no actions at all now, so
      // checking a resting row would pass no matter what this row is.
      fireEvent.click(fpRow);
      expect(within(fpRow).queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
      expect(screen.getByText('0 of 1 object localized')).toBeInTheDocument();
    });

    it("shows each smoke object's type on its row", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      expect(
        within(screen.getByTestId('localize-object-row-object-1')).getByText('wildfire')
      ).toBeInTheDocument();
    });

    it('Tab includes false-positive rows only while the toggle shows them', async () => {
      alertWithFalsePositive();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      // Arrival barrier: only after the auto-select lands does a Tab prove
      // self-cycling — fired earlier it would select lane 101 itself and
      // pass vacuously.
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );

      // Toggle off: the lone smoke object cycles onto itself.
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101');

      fireEvent.click(screen.getByRole('button', { name: /False positives/ }));
      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-2')).toBeInTheDocument();
      });

      // Toggle on: the FP row joins the cycle and Tab lands on it.
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102');
      expect(screen.getByTestId('localize-object-row-object-2')).toHaveAttribute(
        'data-active',
        'true'
      );
    });
  });

  describe('active object CTA, over the media column', () => {
    it('appears above the frames for the active object, following the selection', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      // Await the arrival auto-select's navigation: the CTA only exists once
      // an object is active, and asserting before the navigate commits races
      // it (seen flaking on CI, where the DOM dump showed the bare URL).
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );

      // Arrival auto-selects Object 1, so its CTA is there from the start.
      const cta = within(screen.getByTestId('localize-active-object-actions'));
      expect(cta.getByRole('button', { name: "Accept Object 1's boxes" })).toBeInTheDocument();
      expect(cta.getByRole('button', { name: 'Reclassify Object 1' })).toBeInTheDocument();
      // Each button advertises its page shortcut on a kbd chip.
      expect(
        within(cta.getByRole('button', { name: "Accept Object 1's boxes" })).getByText('Enter')
      ).toBeInTheDocument();
      expect(
        within(cta.getByRole('button', { name: 'Reclassify Object 1' })).getByText('R')
      ).toBeInTheDocument();
      // The column header still names whose frames these are.
      expect(screen.getByText(/Frames — Object 1/)).toBeInTheDocument();

      // Selecting another object hands the CTA to it.
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      expect(
        within(screen.getByTestId('localize-active-object-actions')).getByRole('button', {
          name: 'Reclassify Object 2',
        })
      ).toBeInTheDocument();
      expect(screen.getByText(/Frames — Object 2/)).toBeInTheDocument();
    });

    it('is the actions’ only home — the selected rail row keeps its metadata instead', async () => {
      // The same pair used to also sit on the selected rail row, so every
      // active object showed the buttons twice on one screen. The rail row
      // now always reads as progress + status, buttons or no.
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      // Arrival auto-selects Object 1 — previously the trigger for the row's
      // button swap.
      const row = within(screen.getByTestId('localize-object-row-object-1'));
      // The row's own buttons are its header and its frame segments — never
      // the Accept/Reclassify pair.
      expect(row.queryByRole('button', { name: /Accept|Reclassify/ })).not.toBeInTheDocument();
      expect(row.getByText('0/1')).toBeInTheDocument();
      expect(row.getByText('1 left')).toBeInTheDocument();
    });

    it("accepts the active object's boxes from the header, then reports nothing left and drops the action", async () => {
      vi.mocked(apiClient.createDetectionAnnotation).mockImplementation(async payload => ({
        id: 9100 + payload.detection_id,
        detection_id: payload.detection_id,
        annotation: payload.annotation,
        processing_stage: payload.processing_stage,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: null,
      }));
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: 'Object 1' }));
      fireEvent.click(
        within(screen.getByTestId('localize-active-object-actions')).getByRole('button', {
          name: "Accept Object 1's boxes",
        })
      );
      // The trigger opens the confirm popover; its Accept runs the mutation.
      fireEvent.click(await screen.findByTestId('accept-remaining-confirm'));

      // Object 1's lane is detection 1001 only — the CTA acts on the active
      // object, not on the alert. Object 2's frames (1002, 1003) must never
      // be touched by Object 1's quick-accept.
      await waitFor(() => {
        expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith(
          expect.objectContaining({ detection_id: 1001 })
        );
      });
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalledWith(
        expect.objectContaining({ detection_id: 1002 })
      );
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalledWith(
        expect.objectContaining({ detection_id: 1003 })
      );

      expect(apiClient.updateDetectionAnnotation).not.toHaveBeenCalled();
    });

    it('drops Accept once the object has every box, keeping Reclassify', async () => {
      // Withheld rather than firing a mutation with nothing in it — and the
      // button disappearing is what tells you the accept landed.
      mockAllFramesAccepted();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: 'Object 1' }));

      await waitFor(() => {
        const cta = within(screen.getByTestId('localize-active-object-actions'));
        expect(cta.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
        expect(cta.getByRole('button', { name: 'Reclassify Object 1' })).toBeInTheDocument();
      });
    });
  });

  describe('accept popover', () => {
    // The header's Accept boxes no longer fires the mutation itself — it
    // opens the editor's confirm popover (the same AcceptRemainingPopover),
    // and the popover's own Accept does. Arrival auto-selects Object 1, so
    // its trigger is there without clicking a row first.
    const openPopover = async () => {
      fireEvent.click(await screen.findByRole('button', { name: "Accept Object 1's boxes" }));
      return await screen.findByTestId('accept-remaining-popover');
    };

    it('opens the popover instead of accepting immediately, previewing the active lane', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const popover = await openPopover();

      // The preview loop is wired to the ACTIVE lane, boxes on.
      const loop = within(popover).getByTestId('cropped-image-sequence');
      expect(loop).toHaveAttribute('data-sequence-id', '101');
      expect(loop).toHaveAttribute('data-show-boxes', 'true');
      // Nothing was written by the click.
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalled();
      expect(apiClient.updateDetectionAnnotation).not.toHaveBeenCalled();
    });

    it("confirm accepts exactly the active object's lane and closes the popover", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      await openPopover();
      fireEvent.click(screen.getByTestId('accept-remaining-confirm'));

      // Object 1's lane is detection 1001 only — the popover acts on the
      // active object, never on Object 2's frames.
      await waitFor(() => {
        expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith(
          expect.objectContaining({ detection_id: 1001 })
        );
      });
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalledWith(
        expect.objectContaining({ detection_id: 1002 })
      );
      await waitFor(() => {
        expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
      });
    });

    it('the X and an outside click both close it without accepting', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      await openPopover();
      fireEvent.click(screen.getByTestId('accept-remaining-close'));
      expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();

      await openPopover();
      fireEvent.mouseDown(document.body);
      expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();

      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalled();
    });

    it('offers no Accept button when the lane has nothing acceptable, even though it is not localized', async () => {
      // Lane 101's only frame carries no model box from any source — the
      // editor's rule (acceptRemainingCount > 0) governs the page button
      // too, replacing "not yet localized". A dead trigger would open a
      // popover promising "0 frames have a model box".
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101)
          return [
            {
              ...makeDetection(1001, T1),
              algo_predictions: { predictions: [] },
              auto_predictions: undefined,
            },
          ];
        if (id === 102) return [makeDetection(1002, T1), makeDetection(1003, T2)];
        return [];
      });
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const cta = within(screen.getByTestId('localize-active-object-actions'));
      await waitFor(() => {
        expect(cta.getByRole('button', { name: 'Reclassify Object 1' })).toBeInTheDocument();
      });
      expect(cta.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
    });

    // Key presses need the arrival auto-select to have landed first — the
    // bare URL replace-redirects to the first workable object, and Enter
    // before that has no active object to accept for.
    const awaitAutoSelect = async () => {
      await waitFor(() => {
        expect(screen.getByTestId('localize-object-row-object-1')).toHaveAttribute(
          'data-active',
          'true'
        );
      });
    };

    it('Enter opens the popover for the active object; a second Enter confirms', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      await awaitAutoSelect();

      fireEvent.keyDown(window, { key: 'Enter' });
      expect(await screen.findByTestId('accept-remaining-popover')).toBeInTheDocument();
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalled();

      fireEvent.keyDown(window, { key: 'Enter' });
      await waitFor(() => {
        expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith(
          expect.objectContaining({ detection_id: 1001 })
        );
      });
      await waitFor(() => {
        expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
      });
    });

    it('Escape closes the popover without accepting', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      await awaitAutoSelect();

      fireEvent.keyDown(window, { key: 'Enter' });
      await screen.findByTestId('accept-remaining-popover');
      fireEvent.keyDown(window, { key: 'Escape' });

      expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalled();
    });

    it('Enter on a focused control is left to the control — a rail row keeps its own Enter', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      await awaitAutoSelect();

      const row = screen.getByRole('button', { name: 'Object 2' });
      row.focus();
      fireEvent.keyDown(row, { key: 'Enter' });

      expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
    });

    it('Enter confirms even when focus sits on the trigger button itself', async () => {
      // The natural mouse flow: click "Accept boxes" (focus lands on the
      // trigger), read the dialog, press the advertised Enter. Only buttons
      // INSIDE the dialog keep their own Enter — the editor's carve-out.
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      const trigger = await screen.findByRole('button', { name: "Accept Object 1's boxes" });
      fireEvent.click(trigger);
      await screen.findByTestId('accept-remaining-popover');

      trigger.focus();
      fireEvent.keyDown(trigger, { key: 'Enter' });

      await waitFor(() => {
        expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith(
          expect.objectContaining({ detection_id: 1001 })
        );
      });
      await waitFor(() => {
        expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
      });
    });

    it('closes when the selection moves to another object', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      await openPopover();
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));

      await waitFor(() => {
        expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
      });
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalled();
    });

    it('Enter is inert while the shortcuts sheet is up', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      await awaitAutoSelect();

      fireEvent.keyDown(window, { key: '?' });
      await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
      fireEvent.keyDown(window, { key: 'Enter' });

      expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
    });

    it('Enter does nothing when the active object has nothing acceptable', async () => {
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101)
          return [
            {
              ...makeDetection(1001, T1),
              algo_predictions: { predictions: [] },
              auto_predictions: undefined,
            },
          ];
        if (id === 102) return [makeDetection(1002, T1), makeDetection(1003, T2)];
        return [];
      });
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      await awaitAutoSelect();

      fireEvent.keyDown(window, { key: 'Enter' });

      expect(screen.queryByTestId('accept-remaining-popover')).not.toBeInTheDocument();
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
    });

    it('answering Yes shows the skip-alert nudge — there is no add control anymore', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();

      const row = screen.getByTestId('localize-missed-smoke-row');
      expect(within(row).getByText(/Adding the missed object isn/)).toBeInTheDocument();
      expect(within(row).getByText('Skip alert')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Add object' })).not.toBeInTheDocument();
    });

    it('answering No hides the nudge again', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      answerMissedSmokeYes();
      const noRadio = within(screen.getByTestId('localize-missed-smoke-row')).getByRole('radio', {
        name: 'No',
      });
      await waitFor(() => expect(noRadio).toBeEnabled());
      fireEvent.click(noRadio);

      expect(screen.queryByText(/Adding the missed object isn/)).not.toBeInTheDocument();
    });

    it('done mode: Yes shows no nudge — there is no Skip button to point at', async () => {
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      fireEvent.click(
        within(screen.getByTestId('localize-missed-smoke-row')).getByRole('radio', { name: 'Yes' })
      );

      expect(screen.queryByText(/Adding the missed object isn/)).not.toBeInTheDocument();
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

      fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

      await waitFor(() => {
        expect(
          screen.getByText('You flagged missed smoke but added no object — submit anyway?')
        ).toBeInTheDocument();
      });
      expect(apiClient.localizeSubmit).not.toHaveBeenCalled();
    });

    it('"Go back" cancels — nothing is submitted or patched', async () => {
      mockFlaggedAlert();
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Submit/ }));

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

      fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
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

      fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
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

      fireEvent.click(screen.getByRole('button', { name: /Submit/ }));
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

  describe('URL-addressed selection', () => {
    it("clicking a rail row navigates to that object's selection URL", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));

      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102');
      expect(screen.getByText(/Frames — Object 2/)).toBeInTheDocument();
    });

    it('a second click on the focused row exits focus but keeps the object active (URL unchanged)', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      await waitFor(() =>
        expect(screen.getByTestId('localize-object-row-object-2')).toHaveAttribute('data-active', 'true')
      );

      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));

      // Focus ended: the row loses the selected treatment and crop restores
      // to its pre-focus off state…
      await waitFor(() =>
        expect(screen.getByTestId('localize-object-row-object-2')).not.toHaveAttribute('data-active')
      );
      await waitFor(() => {
        const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
        expect(img.style.transform).toBe('');
      });
      // …but the object stays active: URL and Frames panel still name it.
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102');
      expect(screen.getByText(/Frames — Object 2/)).toBeInTheDocument();
    });

    it("closing the editor lands on the edited object's selection URL, not the bare alert URL", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      // Select Object 2 first — T2's cell is only interactive while its
      // object is active (auto-select landed on Object 1), and closing from
      // lane 102 also proves the close target is the EDITED object's URL,
      // not the arrival auto-select's.
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      // T2 is present only in lane 102 (Object 2 / detection 1003).
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T2}`));
      await screen.findByTestId('image-modal');

      fireEvent.click(screen.getByRole('button', { name: 'Mock Close' }));

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent(/\/localize\/101\/object\/102$/)
      );
      expect(screen.queryByTestId('image-modal')).not.toBeInTheDocument();
    });

    it('a directly-loaded selection URL arrives with that object active', async () => {
      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper(localizeObjectSelect(101, 102)),
      });

      expect(screen.getByText(/Frames — Object 2/)).toBeInTheDocument();
    });

    it('a bare alert URL replace-redirects to the first workable object, arriving focused', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );
      expect(screen.getByText(/Frames — Object 1/)).toBeInTheDocument();
      // The auto-selection is a full focus entry, as if the row was clicked:
      // row selected, cells cropped around the object's boxes.
      expect(screen.getByTestId('localize-object-row-object-1')).toHaveAttribute('data-active', 'true');
      await waitFor(() => {
        const img = within(screen.getByTestId(`alert-frame-cell-${T1}`)).getByRole('img');
        expect(img.style.transform).toContain('scale(');
      });
    });

    it('the auto-select redirect replaces history — Back returns to the list, not the bare URL', async () => {
      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper('/localize/101', [ROUTES.LOCALIZE]),
      });
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );

      fireEvent.click(screen.getByRole('button', { name: 'history-back-probe' }));

      expect(await screen.findByTestId('localize-queue-landing')).toBeInTheDocument();
    });

    it('falls back to the first smoke object when every object is already localized', async () => {
      // Both lanes annotated: no workable object left, so the first smoke
      // object is the arrival selection (the normal done-mode case).
      const detail = makeTwoLaneAlertDetail();
      detail.lanes.forEach(lane => {
        lane.annotation!.processing_stage = 'annotated';
      });
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue(detail);

      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/done/101/object/101')
      );
    });

    it('stays on the bare URL, nothing selected, when the alert has no smoke lanes', async () => {
      // FP-only alert: with the toggle off the frame model materializes no
      // objects, so there is nothing to auto-select.
      const detail = makeTwoLaneAlertDetail();
      detail.lanes.forEach(lane => {
        lane.annotation = makeAnnotation({
          ...lane.annotation,
          has_smoke: false,
          smoke_types: [],
          false_positive_types: '["cloud"]',
        });
      });
      vi.mocked(apiClient.getAlertDetail).mockResolvedValue(detail);

      render(<LocalizeAlertPage />, { wrapper });

      // No smoke rows to settle on; wait for the page shell instead.
      await screen.findByText(/CAM-1/);
      expect(screen.getByTestId('location')).toHaveTextContent(/\/localize\/101$/);
    });

    it('a selection URL naming a lane not in this alert redirects to bare, then re-auto-selects', async () => {
      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper(localizeObjectSelect(101, 999)),
      });

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );
    });

    it('done provenance auto-selects under its own prefix', async () => {
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/done/101/object/101')
      );
    });

    it('a stale ?frame= param does not outvote the object a selection URL names', async () => {
      // Detection 1002 belongs to lane 102, but the URL names Object 1.
      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper('/localize/101/object/101?frame=1002'),
      });

      // The frame still gets its arrival highlight…
      await waitFor(() =>
        expect(screen.getByTestId(`alert-frame-cell-${T1}`)).toHaveAttribute(
          'data-highlighted',
          'true'
        )
      );
      // …but the path is the selection's source of truth.
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/localize/101/object/101?frame=1002'
      );
      expect(screen.getByText(/Frames — Object 1/)).toBeInTheDocument();
    });

    it('a deep-loaded editor URL carrying ?frame= stays in the editor', async () => {
      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper('/localize/101/object/102/1003?frame=1002'),
      });

      await waitFor(() =>
        expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1003')
      );
      expect(screen.getByTestId('location')).toHaveTextContent(
        '/localize/101/object/102/1003?frame=1002'
      );
    });

    it('a selection URL naming an FP lane (toggle off) falls back to auto-select', async () => {
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
              smoke_types: [],
              false_positive_types: '["cloud"]',
            }),
          },
        ],
      });

      // Lane 102 exists on the alert but is a false positive — with the
      // toggle off it is not in the frame model, so it is not URL-selectable.
      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper(localizeObjectSelect(101, 102)),
      });

      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );
    });
  });

  describe('Tab object cycling', () => {
    it('Tab activates the next object: URL moves to its selection route and focus mode follows', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      // Wait out the arrival auto-focus of Object 1 (lane 101): a Tab fired
      // before that effect's navigation commits would legitimately select
      // lane 101 itself (the no-active-object branch), not step off it.
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );

      fireEvent.keyDown(document, { key: 'Tab' });

      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102');
      // Focus mode came along: the rail row shows the selected treatment.
      await waitFor(() =>
        expect(screen.getByTestId('localize-object-row-object-2')).toHaveAttribute(
          'data-active',
          'true'
        )
      );
    });

    it('Tab wraps past the last object; Shift+Tab steps back and wraps past the first', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      // Arrival barrier — see the first test; without it the first Tab can
      // race the auto-select and land on lane 101 as the no-active-object
      // branch (CI caught exactly that).
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );

      // 101 -> 102 -> wrap -> 101.
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102');
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101');

      // Backward from the first wraps to the last.
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102');
    });

    it('moves DOM focus with the cycle, so Enter acts on the landed row — not one left behind', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );

      // As after a real click: the browser focuses the clicked row's header,
      // and a native button keeps its own Enter/Space activation.
      const row1 = screen.getByRole('button', { name: 'Object 1' });
      row1.focus();

      fireEvent.keyDown(document, { key: 'Tab' });

      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102');
      const row2 = screen.getByRole('button', { name: 'Object 2' });
      expect(document.activeElement).toBe(row2);
      // Activation lands on the cycled-to row: without focus following the
      // cycle, the browser would fire row 1's handler and yank the
      // selection back. (Native Enter->click is browser behavior jsdom
      // doesn't synthesize, so the claim is made with a click on the
      // focused element.)
      fireEvent.click(row2);
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102');
    });

    it('is inert while the per-frame editor is open, so the editor keeps its own keys', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      // Open the editor on the arrival object's T1 frame (lane 101,
      // detection 1001).
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T1}`));
      await screen.findByTestId('image-modal');
      const editorUrl = screen.getByTestId('location').textContent;

      fireEvent.keyDown(document, { key: 'Tab' });

      // No cycling happened: the URL still names the open editor.
      expect(screen.getByTestId('location')).toHaveTextContent(editorUrl!);
      expect(screen.getByTestId('image-modal')).toBeInTheDocument();
    });
  });

  describe('keyboard shortcuts help', () => {
    const arrive = async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      // Wait out the arrival auto-select, as every keyboard test here does.
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );
    };

    it("'?' opens the shortcuts sheet and Escape closes it", async () => {
      await arrive();
      fireEvent.keyDown(window, { key: '?' });
      expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    });

    it("'?' pressed again closes the sheet", async () => {
      await arrive();
      fireEvent.keyDown(window, { key: '?' });
      fireEvent.keyDown(window, { key: '?' });
      expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    });

    it('the rail button opens the sheet, which lists the page keys', async () => {
      await arrive();
      fireEvent.click(screen.getByTitle('Show keyboard shortcuts (?)'));
      const dialog = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
      expect(dialog).toHaveTextContent('Cycle objects');
      expect(dialog).toHaveTextContent('Crop cells');
      expect(dialog).toHaveTextContent('Toggle this help');
      expect(dialog).toHaveTextContent("Accept the model's boxes");
      expect(dialog).toHaveTextContent('Reclassify the object');
    });

    it("'?' is inert while the per-frame editor is open", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      fireEvent.click(screen.getByTestId(`alert-frame-cell-${T1}`));
      await screen.findByTestId('image-modal');

      fireEvent.keyDown(window, { key: '?' });

      expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
    });

    it('Tab is inert while the sheet is open, so its close button stays reachable', async () => {
      await arrive();
      fireEvent.keyDown(window, { key: '?' });

      fireEvent.keyDown(document, { key: 'Tab' });

      // No cycling happened behind the dialog: the URL still names the
      // arrival object, and the sheet is still up.
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101');
      expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    });

    it("'c' is inert while the sheet is open", async () => {
      await arrive();
      fireEvent.keyDown(window, { key: '?' });

      const crop = screen.getByTitle('Crop cells (C)');
      const before = crop.getAttribute('aria-pressed');
      fireEvent.keyDown(window, { key: 'c' });

      expect(crop).toHaveAttribute('aria-pressed', before!);
    });
  });

  describe('page view keys', () => {
    const arrive = async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101')
      );
    };

    it("'l' switches to large cards", async () => {
      await arrive();
      fireEvent.keyDown(window, { key: 'l' });
      expect(screen.getByTitle('Large cards')).toHaveAttribute('aria-pressed', 'true');
    });

    it("'M' (uppercase) switches to medium cards", async () => {
      // NOT 'S': the arrival focus-mode override already presses Small, so an
      // 'S' assertion would pass before the key exists. Medium starts
      // unpressed under the override, so this genuinely fails first.
      await arrive();
      fireEvent.keyDown(window, { key: 'M' });
      expect(screen.getByTitle('Medium cards')).toHaveAttribute('aria-pressed', 'true');
    });

    it("'p' opens and closes the cropped loop", async () => {
      await arrive();
      fireEvent.keyDown(window, { key: 'p' });
      expect(screen.getByTestId('cropped-image-sequence')).toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'p' });
      expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();
    });

    it("'p' is inert when the active object has no boxes", async () => {
      // Boxless variants of BOTH lanes, so wherever arrival lands, canShowCrop
      // stays false (mirrors the button's own withheld state).
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101)
          return [{ ...makeDetection(1001, T1), auto_predictions: { predictions: [] } }];
        if (id === 102)
          return [
            { ...makeDetection(1002, T1), auto_predictions: { predictions: [] } },
            { ...makeDetection(1003, T2), auto_predictions: { predictions: [] } },
          ];
        return [];
      });
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/')
      );
      expect(screen.queryByRole('button', { name: 'Cropped view' })).not.toBeInTheDocument();
      fireEvent.keyDown(window, { key: 'p' });
      expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();
    });

    it('size keys are inert while the shortcuts sheet is open', async () => {
      await arrive();
      fireEvent.keyDown(window, { key: '?' });
      fireEvent.keyDown(window, { key: 'l' });
      expect(screen.getByTitle('Large cards')).toHaveAttribute('aria-pressed', 'false');
    });
  });

  describe('reclassify', () => {
    it("navigates to the row's OWN lane in classify done mode, carrying a return to this page", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      // Reclassify sits in the CTA bar for the active object, so select
      // Object 2 first.
      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      fireEvent.click(
        within(screen.getByTestId('localize-active-object-actions')).getByRole('button', {
          name: 'Reclassify Object 2',
        })
      );

      const destination = await screen.findByTestId('classify-destination');
      // Object 2 is lane 102 — not 101, the alert's entry sequence. The
      // return names that object's own selection URL, so the round trip
      // lands back with it selected.
      expect(destination.getAttribute('data-lane-id')).toBe('102');
      expect(destination.getAttribute('data-return')).toBe('/localize/101/object/102');
    });

    it('returns to the DONE page when the reclassify started from done mode', async () => {
      // Both provenances render this page, so the return target has to follow
      // the one the annotator is actually on — sending them to the queue-mode
      // URL for the same alert would silently change which list they came
      // from.
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      fireEvent.click(
        within(screen.getByTestId('localize-active-object-actions')).getByRole('button', {
          name: 'Reclassify Object 2',
        })
      );

      const destination = await screen.findByTestId('classify-destination');
      expect(destination.getAttribute('data-lane-id')).toBe('102');
      expect(destination.getAttribute('data-return')).toBe('/localize/done/101/object/102');
    });

    it("'R' reclassifies the active object from the keyboard", async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      fireEvent.keyDown(window, { key: 'r' });

      const destination = await screen.findByTestId('classify-destination');
      expect(destination.getAttribute('data-lane-id')).toBe('102');
      expect(destination.getAttribute('data-return')).toBe('/localize/101/object/102');
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

      fireEvent.click(screen.getByRole('button', { name: 'Object 2' }));
      const cta = within(screen.getByTestId('localize-active-object-actions'));
      // Context objects carry no Accept boxes action, but stay correctable.
      expect(cta.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
      expect(cta.getByRole('button', { name: 'Reclassify Object 2' })).toBeInTheDocument();
    });

    it('offers Reclassify on a false-positive context row (FP -> smoke, issue #275)', async () => {
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

      // Still no localization action — but the classification is correctable.
      fireEvent.click(await screen.findByRole('button', { name: 'Object 2' }));
      const cta = within(screen.getByTestId('localize-active-object-actions'));
      expect(cta.queryByRole('button', { name: /Accept/ })).not.toBeInTheDocument();
      fireEvent.click(cta.getByRole('button', { name: 'Reclassify Object 2' }));

      // Same destination contract as smoke rows: the row's OWN lane, with a
      // return naming that object's selection URL. If the lane comes back
      // promoted to smoke it arrives selected; if it stays FP, the arrival
      // validation bounces the URL to the normal auto-select.
      const destination = await screen.findByTestId('classify-destination');
      expect(destination.getAttribute('data-lane-id')).toBe('102');
      expect(destination.getAttribute('data-return')).toBe('/localize/101/object/102');
    });
  });

  describe('skip alert', () => {
    it('opens the confirm dialog with an optional note field', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Skip alert/ }));

      expect(screen.getByTestId('skip-alert-confirm')).toBeInTheDocument();
      expect(screen.getByLabelText(/optional/i)).toBeInTheDocument();
    });

    it('the close cross dismisses without calling the API', async () => {
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Skip alert/ }));
      fireEvent.click(
        within(screen.getByTestId('skip-alert-confirm')).getByRole('button', { name: 'Close' })
      );

      expect(screen.queryByTestId('skip-alert-confirm')).not.toBeInTheDocument();
      expect(apiClient.skipAlert).not.toHaveBeenCalled();
    });

    it('confirm sends the trimmed note and navigates to the queue list', async () => {
      vi.mocked(apiClient.skipAlert).mockResolvedValue({
        skipped_at: '2026-08-05T10:00:00Z',
        skipped_by: 'annotator',
        note: 'cannot box this',
      });
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Skip alert/ }));
      fireEvent.change(screen.getByLabelText(/optional/i), {
        target: { value: '  cannot box this  ' },
      });
      fireEvent.click(
        within(screen.getByTestId('skip-alert-confirm')).getByRole('button', {
          name: /Skip alert/,
        })
      );

      await waitFor(() => {
        expect(apiClient.skipAlert).toHaveBeenCalledWith('pyronear_french', 500, 'cannot box this');
      });
      await waitFor(() => {
        expect(screen.getByTestId('localize-queue-landing')).toBeInTheDocument();
      });
    });

    it('shows an error toast and keeps the dialog when the skip fails', async () => {
      vi.mocked(apiClient.skipAlert).mockRejectedValue({ detail: 'Alert is already skipped' });
      await renderAndSettle(<LocalizeAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Skip alert/ }));
      fireEvent.click(
        within(screen.getByTestId('skip-alert-confirm')).getByRole('button', {
          name: /Skip alert/,
        })
      );

      await waitFor(() => {
        expect(screen.getByText(/already skipped/i)).toBeInTheDocument();
      });
      expect(screen.getByTestId('skip-alert-confirm')).toBeInTheDocument();
    });

    it('does not offer skip in done mode', async () => {
      await renderAndSettle(<LocalizeAlertPage mode="done" />, { wrapper: doneWrapper });

      expect(screen.queryByRole('button', { name: /Skip alert/ })).not.toBeInTheDocument();
    });
  });

  describe('gap frames (issue #287)', () => {
    it('drawing on a gap frame materializes it, saves the box, and moves the URL', async () => {
      const newDet = { ...makeDetection(5001, T2), sequence_id: 101 };
      let materialized = false;
      vi.mocked(apiClient.materializeFrame).mockImplementation(async () => {
        materialized = true;
        return newDet;
      });
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101)
          return materialized ? [makeDetection(1001, T1), newDet] : [makeDetection(1001, T1)];
        if (id === 102) return [makeDetection(1002, T1), makeDetection(1003, T2)];
        return [];
      });

      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper('/localize/101/object/101/1001'),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Mock Gap Draw' }));

      await waitFor(() => expect(apiClient.materializeFrame).toHaveBeenCalledWith(101, T2));
      await waitFor(() =>
        expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith(
          expect.objectContaining({ detection_id: 5001, processing_stage: 'annotated' })
        )
      );
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101/5001')
      );
    });

    it('leaves the frame a gap when the materialize call fails', async () => {
      vi.mocked(apiClient.materializeFrame).mockRejectedValue({ detail: 'boom', status: 500 });

      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper('/localize/101/object/101/1001'),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Mock Gap Draw' }));

      await waitFor(() => expect(apiClient.materializeFrame).toHaveBeenCalled());
      expect(apiClient.createDetectionAnnotation).not.toHaveBeenCalled();
      // URL never moved: the frame is still a gap, the editor still open on 1001.
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101/1001');
      expect(screen.getByTestId('image-modal-detection-id')).toHaveTextContent('1001');
    });

    it('shows the frame as boxless in-object when the save fails after the materialize', async () => {
      const newDet = { ...makeDetection(5001, T2), sequence_id: 101 };
      let materialized = false;
      vi.mocked(apiClient.materializeFrame).mockImplementation(async () => {
        materialized = true;
        return newDet;
      });
      vi.mocked(apiClient.createDetectionAnnotation).mockRejectedValue({
        detail: 'boom',
        status: 500,
      });
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101)
          return materialized ? [makeDetection(1001, T1), newDet] : [makeDetection(1001, T1)];
        if (id === 102) return [makeDetection(1002, T1), makeDetection(1003, T2)];
        return [];
      });

      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper('/localize/101/object/101/1001'),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Mock Gap Draw' }));

      await waitFor(() => expect(apiClient.materializeFrame).toHaveBeenCalled());
      // The onError invalidation refetches the lane, so the materialized frame
      // arrives as a boxless in-object frame; the URL stays on the old one.
      await waitFor(() =>
        expect(screen.getByTestId('image-modal-lane-frames')).toHaveTextContent('2')
      );
      expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/101/1001');
    });

    it('clearing an evidence-free frame un-materializes it and steps the URL off it', async () => {
      // Lane 102's T2 frame carries no model evidence — the materialized shape.
      const bare = {
        ...makeDetection(1003, T2),
        auto_predictions: null,
      };
      let deleted = false;
      vi.mocked(apiClient.unmaterializeFrame).mockImplementation(async () => {
        deleted = true;
      });
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101) return [makeDetection(1001, T1)];
        if (id === 102) return deleted ? [makeDetection(1002, T1)] : [makeDetection(1002, T1), bare];
        return [];
      });

      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper('/localize/101/object/102/1003'),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Mock Unmaterialize' }));

      await waitFor(() => expect(apiClient.unmaterializeFrame).toHaveBeenCalledWith(102, 1003));
      await waitFor(() =>
        expect(screen.getByTestId('location')).toHaveTextContent('/localize/101/object/102/1002')
      );
    });

    it('falls back to a confirmed-empty clear when the un-materialize is refused', async () => {
      const bare = {
        ...makeDetection(1003, T2),
        auto_predictions: null,
      };
      vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
        if (id === 101) return [makeDetection(1001, T1)];
        if (id === 102) return [bare]; // last frame -> the server would 409
        return [];
      });
      vi.mocked(apiClient.unmaterializeFrame).mockRejectedValue({
        detail: "Cannot remove the lane's last frame",
        status: 409,
      });

      await renderAndSettle(<LocalizeAlertPage />, {
        wrapper: makeWrapper('/localize/101/object/102/1003'),
      });
      fireEvent.click(screen.getByRole('button', { name: 'Mock Unmaterialize' }));

      await waitFor(() =>
        expect(apiClient.createDetectionAnnotation).toHaveBeenCalledWith(
          expect.objectContaining({
            detection_id: 1003,
            annotation: { annotation: [] },
            processing_stage: 'annotated',
          })
        )
      );
    });
  });

  it('shows a shared timeline legend listing only the statuses on screen', async () => {
    // Default fixture: every present frame carries an unaccepted model box.
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    const legend = screen.getByTestId('localize-timeline-legend');
    expect(within(legend).getByText('model box to accept')).toBeInTheDocument();
    expect(within(legend).queryByText('committed')).not.toBeInTheDocument();
    expect(within(legend).queryByText('no box')).not.toBeInTheDocument();
  });

  it('collapses the legend to just "committed" once every frame is accepted', async () => {
    mockAllFramesAccepted();
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    const legend = screen.getByTestId('localize-timeline-legend');
    expect(within(legend).getByText('committed')).toBeInTheDocument();
    expect(within(legend).queryByText('model box to accept')).not.toBeInTheDocument();
    expect(within(legend).queryByText('no box')).not.toBeInTheDocument();
  });

  it('shows all three chips when the alert mixes committed, pending and boxless frames', async () => {
    // Lane 101's frame is committed (annotated-stage annotation), lane 102's
    // T1 keeps its default pending model box, and its T2 detection offers no
    // box at all — the `empty` outline state.
    vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (id: number) => {
      if (id === 101) return [makeDetection(1001, T1)];
      if (id === 102)
        return [
          makeDetection(1002, T1),
          { ...makeDetection(1003, T2), auto_predictions: { predictions: [] } },
        ];
      return [];
    });
    vi.mocked(apiClient.getDetectionAnnotations).mockImplementation(async filters => {
      const items = filters?.sequence_id === 101 ? [makeDetectionAnnotation(1001)] : [];
      return { ...emptyAnnotationsPage, items, total: items.length };
    });
    await renderAndSettle(<LocalizeAlertPage />, { wrapper });

    const legend = screen.getByTestId('localize-timeline-legend');
    expect(within(legend).getByText('committed')).toBeInTheDocument();
    expect(within(legend).getByText('model box to accept')).toBeInTheDocument();
    expect(within(legend).getByText('no box')).toBeInTheDocument();
  });
});
