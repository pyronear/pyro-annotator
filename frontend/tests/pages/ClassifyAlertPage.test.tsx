/**
 * Tests for ClassifyAlertPage: the collocated classify cockpit that renders
 * every object (lane) of one alert — a media panel for the active object
 * plus a decision rail of per-object rows — and submits them all in a
 * single classifySubmit call (queue mode) or per-lane PATCHes (done mode).
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { AlertDetail, Sequence, SequenceAnnotation, ClassifySubmitRequest } from '@/types/api';
import { getObjectColor } from '@/utils/annotation/objectColors';

vi.mock('@/services/api', () => ({
  apiClient: {
    getSequence: vi.fn(),
    getAlertDetail: vi.fn(),
    classifySubmit: vi.fn(),
    getSequenceDetections: vi.fn(),
    updateSequenceAnnotation: vi.fn(),
    getClassifyQueue: vi.fn(),
    skipAlert: vi.fn(),
  },
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

// The media panel's full-frame player stand-in exposes the bbox count it
// was handed — renderAndSettle keys on it as the "seeded state has
// committed" signal (see its comment) — and the seek request, so the
// segment-click → player plumbing is observable (React drops the
// attributes entirely while the request is null/undefined).
vi.mock('@/components/annotation/FullImageSequence', () => ({
  default: ({
    bboxes,
    seekRequest,
  }: {
    bboxes?: unknown[];
    seekRequest?: { index: number; nonce: number } | null;
  }) => (
    <div
      data-testid="full-image-sequence"
      data-bbox-count={bboxes?.length ?? 0}
      data-seek-index={seekRequest?.index}
      data-seek-nonce={seekRequest?.nonce}
    />
  ),
}));
vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  default: () => <div data-testid="cropped-image-sequence" />,
}));

// The whole-alert player (SequenceReviewer -> SequencePlayer) fetches
// detections and renders a full playback UI unrelated to this page's own
// logic; swap it for a trivial stand-in. It only mounts once the
// missed-smoke section is activated (the media panel swaps to it).
// `objectOverlaysSpy` captures the `objectOverlays` prop the page builds
// for it so overlay wiring can be asserted without rendering the real
// player.
const objectOverlaysSpy = vi.fn();
vi.mock('@/components/sequence/SequenceReviewer', () => ({
  default: (props: { objectOverlays?: unknown }) => {
    objectOverlaysSpy(props.objectOverlays);
    return <div data-testid="sequence-reviewer" />;
  },
}));

import { apiClient } from '@/services/api';
import ClassifyAlertPage from '@/pages/ClassifyAlertPage';
import { useSequenceStore } from '@/store/useSequenceStore';

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/classify/101']}>
        <Routes>
          <Route path="/classify/:id" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

/** Same shell as `wrapper`, but mounted under /classify/done/:id (done mode's route). */
function makeDoneWrapper(entrySequenceId: number, search = '') {
  return function DoneWrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/classify/done/${entrySequenceId}${search}`]}>
          <Routes>
            <Route path="/classify/done/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );
  };
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
    has_smoke: false,
    has_false_positives: false,
    false_positive_types: '[]',
    smoke_types: [],
    has_missed_smoke: false,
    is_unsure: false,
    annotation: {
      sequences_bbox: [
        {
          is_smoke: false,
          false_positive_types: [],
          bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
        },
      ],
    },
    processing_stage: 'ready_to_annotate',
    created_at: '2026-01-01T09:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function makeAlertDetail(): AlertDetail {
  const laneA = {
    sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
    annotation: makeAnnotation({ id: 201, sequence_id: 101 }),
  };
  const laneB = {
    sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
    annotation: makeAnnotation({
      id: 202,
      sequence_id: 102,
      annotation: {
        sequences_bbox: [
          {
            is_smoke: false,
            false_positive_types: [],
            bboxes: [{ detection_id: 2, xyxyn: [0, 0, 1, 1] }],
          },
        ],
      },
    }),
  };
  const laneC = {
    sequence: makeSequence({ id: 103, alert_api_id: 9003 }),
    annotation: makeAnnotation({
      id: 203,
      sequence_id: 103,
      processing_stage: 'annotated',
      has_smoke: true,
      annotation: {
        sequences_bbox: [
          {
            is_smoke: true,
            smoke_type: 'wildfire',
            false_positive_types: [],
            bboxes: [{ detection_id: 3, xyxyn: [0, 0, 1, 1] }],
          },
        ],
      },
    }),
  };
  return {
    source_api: 'pyronear_french',
    platform_alert_id: 500,
    camera_name: 'CAM-1',
    organisation_name: 'Org',
    recorded_at: '2026-01-01T10:00:00Z',
    lanes: [laneA, laneB, laneC],
  };
}

/**
 * Renders the page and waits for the entry row's SEEDED state to have
 * committed — not just its presence. Used by every test in this file
 * instead of `render(...)` + a bare `waitFor(testid present)`.
 *
 * The page settles across separate React commits: (1) alert-detail arrives
 * and rows render structurally, (2) a `useEffect` activates the entry row
 * (queue: first editable; done: the clicked sequence), and (3) another
 * `useEffect` (`initializeFromAlertDetail`) seeds classification/bbox/
 * unsure/missed-smoke local state from that same data — which is what
 * actually drives checked chips, status labels, and the media panel's bbox
 * data. Under slow/CI scheduling, `waitFor` can observe the DOM in the gap
 * between those commits. Interacting with a row before the seed commit
 * lands is also unsafe: chip handlers spread the CURRENT bbox prop, which
 * is still the `EMPTY_BBOX` placeholder pre-seed, silently discarding the
 * row's real bbox data.
 *
 * Every fixture's entry lane seeds >= 1 bbox entry, and the (mocked)
 * full-frame player reports the bbox count it was handed — so waiting for
 * that count to move off "0" is a settle signal common to every scenario
 * here: it proves an object is active AND its seeded (non-EMPTY_BBOX) data
 * reached the media panel.
 */
async function renderAndSettle(
  ui: React.ReactElement,
  options: { wrapper: React.ComponentType<{ children: React.ReactNode }> }
): Promise<void> {
  render(ui, options);
  await waitFor(() => {
    expect(screen.getByTestId('full-image-sequence').getAttribute('data-bbox-count')).not.toBe('0');
  });
}

/** Activate a row, then return a `within` scope for it (chips only render on the active row). */
function openRow(cardKey: string) {
  fireEvent.click(screen.getByTestId(`object-card-${cardKey}`));
  return within(screen.getByTestId(`object-card-${cardKey}`));
}

/** The missed-smoke rail row's Yes/No chips. */
function missedSmokeChip(name: 'Yes' | 'No') {
  return within(screen.getByTestId('missed-smoke-row')).getByRole('radio', { name });
}

describe('ClassifyAlertPage', () => {
  beforeEach(() => {
    // Clears call counts (not just implementations) so per-test assertions
    // like `toHaveBeenCalledTimes` aren't polluted by earlier tests' calls.
    vi.clearAllMocks();
    // jsdom doesn't implement scrollIntoView; done-mode's entry-row
    // activation calls it on the target row, so stub it as a no-op.
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(apiClient.getSequence).mockResolvedValue(makeSequence());
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(makeAlertDetail());
    // Default: no detections, so overlay-building code has something to
    // resolve against without erroring; overridden per-test where the
    // overlay content itself is under test.
    vi.mocked(apiClient.getSequenceDetections).mockResolvedValue([]);
    // Default: empty queue, so post-submit auto-advance falls through to the
    // "workflow completed" path most tests assert.
    vi.mocked(apiClient.getClassifyQueue).mockResolvedValue({
      items: [],
      page: 1,
      pages: 0,
      size: 2,
      total: 0,
    });
    vi.mocked(apiClient.classifySubmit).mockResolvedValue({
      results: [
        {
          annotation_id: 201,
          sequence_id: 101,
          processing_stage: 'seq_annotation_done',
          group_propagation_warning: null,
        },
        {
          annotation_id: 202,
          sequence_id: 102,
          processing_stage: 'annotated',
          group_propagation_warning: null,
        },
      ],
    });
  });

  it('renders one rail row per lane-track for a 3-lane alert', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });
    expect(
      within(screen.getByTestId('object-card-101:0')).getByText('Object 1')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('object-card-102:0')).getByText('Object 2')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('object-card-103:0')).getByText('Object 3')
    ).toBeInTheDocument();
  });

  it('renders the locked lane row read-only with a stage badge and its classification summary', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const lockedRow = within(screen.getByTestId('object-card-103:0'));
    expect(lockedRow.getByText('Fully annotated')).toBeInTheDocument();
    // Its existing (already-submitted) classification renders, not blank.
    expect(lockedRow.getByText('Smoke · Wildfire')).toBeInTheDocument();

    // Activating the locked row shows its media but never chips.
    fireEvent.click(screen.getByTestId('object-card-103:0'));
    expect(lockedRow.queryByRole('radio', { name: 'Smoke' })).not.toBeInTheDocument();

    // An editable row does render enabled chips once active.
    const editableRow = openRow('101:0');
    expect(editableRow.getByRole('radio', { name: 'Smoke' })).not.toBeDisabled();
  });

  it('disables submit until every editable row is classified and missed smoke is answered', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const submitButton = screen.getAllByRole('button', { name: /^Submit$/i })[0];
    expect(submitButton).toBeDisabled();

    // Classify object 1 as smoke + wildfire
    const cardA = openRow('101:0');
    fireEvent.click(cardA.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardA.getByRole('radio', { name: 'Wildfire' }));

    expect(submitButton).toBeDisabled();

    // Classify object 2 as false positive + a type
    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));

    // Still missing the missed-smoke review
    expect(submitButton).toBeDisabled();

    fireEvent.click(missedSmokeChip('No'));

    expect(submitButton).not.toBeDisabled();
  });

  it('starts a placeholder track (is_smoke true, smoke_type null) unselected — not pre-filled as smoke — and keeps submit disabled', async () => {
    // The alert-API import writes each object's single track this way: a
    // structural placeholder, not a human decision. TypeScript's SequenceBbox
    // types smoke_type as `SmokeType | undefined`, but the real backend
    // payload carries a literal JSON `null` here — cast past that to
    // reproduce the actual wire shape.
    const placeholderAlertDetail = {
      ...makeAlertDetail(),
      lanes: [
        {
          sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
          annotation: makeAnnotation({
            id: 201,
            sequence_id: 101,
            annotation: {
              sequences_bbox: [
                {
                  is_smoke: true,
                  smoke_type: null,
                  false_positive_types: [],
                  bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
                },
              ],
            },
          }),
        },
      ],
    } as unknown as AlertDetail;

    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(placeholderAlertDetail);

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    // The single editable row auto-activates, so its chips are on screen.
    const card = within(screen.getByTestId('object-card-101:0'));
    expect(card.getByRole('radio', { name: 'Smoke' })).not.toBeChecked();
    expect(card.getByRole('radio', { name: 'False positive' })).not.toBeChecked();
    expect(card.getByText('Pending')).toBeInTheDocument();
    expect(card.queryByText(/Smoke ·/)).not.toBeInTheDocument();

    // Even after answering missed smoke, submit stays disabled — the
    // placeholder track alone doesn't count as classified.
    fireEvent.click(missedSmokeChip('No'));
    expect(screen.getAllByRole('button', { name: /^Submit$/i })[0]).toBeDisabled();
  });

  it('still pre-fills a genuinely labeled track (e.g. group inheritance) that carries a real smoke_type', async () => {
    const preLabeledAlertDetail: AlertDetail = {
      ...makeAlertDetail(),
      lanes: [
        {
          sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
          annotation: makeAnnotation({
            id: 201,
            sequence_id: 101,
            annotation: {
              sequences_bbox: [
                {
                  is_smoke: true,
                  smoke_type: 'wildfire',
                  false_positive_types: [],
                  bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
                },
              ],
            },
          }),
        },
      ],
    };

    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(preLabeledAlertDetail);

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const card = within(screen.getByTestId('object-card-101:0'));
    expect(card.getByRole('radio', { name: 'Smoke' })).toBeChecked();
    expect(card.getByText('Smoke · Wildfire')).toBeInTheDocument();

    fireEvent.click(missedSmokeChip('No'));
    expect(screen.getAllByRole('button', { name: /^Submit$/i })[0]).not.toBeDisabled();
  });

  it('submits with per-lane stages: FP-only lane annotated, smoke lane seq_annotation_done, primary carries has_missed_smoke', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const cardA = openRow('101:0');
    fireEvent.click(cardA.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardA.getByRole('radio', { name: 'Wildfire' }));

    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));

    fireEvent.click(missedSmokeChip('Yes'));

    const submitButton = screen.getAllByRole('button', { name: /^Submit$/i })[0];
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => expect(apiClient.classifySubmit).toHaveBeenCalledTimes(1));

    const payload = vi.mocked(apiClient.classifySubmit).mock.calls[0][0] as ClassifySubmitRequest;
    expect(payload.items).toHaveLength(2); // locked lane (103) excluded

    const itemA = payload.items.find(i => i.annotation_id === 201)!;
    expect(itemA.processing_stage).toBe('seq_annotation_done');
    expect(itemA.has_missed_smoke).toBe(true);
    expect(itemA.annotation.sequences_bbox[0].is_smoke).toBe(true);
    expect(itemA.annotation.sequences_bbox[0].smoke_type).toBe('wildfire');

    const itemB = payload.items.find(i => i.annotation_id === 202)!;
    expect(itemB.processing_stage).toBe('annotated');
    expect(itemB.has_missed_smoke).toBe(false);
    expect(itemB.annotation.sequences_bbox[0].false_positive_types).toContain('antenna');

    // Regression guard: queue mode (no `mode` prop) must keep using the
    // atomic classify-submit endpoint, never the per-lane PATCH done mode uses.
    expect(apiClient.updateSequenceAnnotation).not.toHaveBeenCalled();

    // A successful submit with no active workflow schedules a 1s-deferred
    // navigate(backUrl) (see AnnotationInterface-derived onSuccess). If this
    // test ended here, that real setTimeout would still be pending after
    // the test completes and could fire navigateMock mid-flight during a
    // later test — draining it here keeps every test's side effects inside
    // its own lifetime.
    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('renders Submit disabled when every lane is already locked (deep-linking a fully-classified alert)', async () => {
    // Zero editable rows: `isComplete` (`.every()` over an empty list) is
    // vacuously true, and the primary lane's own submitted missed-smoke
    // answer makes `missedSmokeReview !== null` true too — without an
    // explicit "something to submit" guard, Submit would stay enabled and
    // an empty-items classifySubmit would always 422.
    const fullyLockedDetail: AlertDetail = {
      ...makeAlertDetail(),
      lanes: [
        {
          sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
          annotation: makeAnnotation({
            id: 201,
            sequence_id: 101,
            processing_stage: 'annotated',
            has_smoke: true,
            has_missed_smoke: true,
            annotation: {
              sequences_bbox: [
                {
                  is_smoke: true,
                  smoke_type: 'wildfire',
                  false_positive_types: [],
                  bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
                },
              ],
            },
          }),
        },
        {
          sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
          annotation: makeAnnotation({
            id: 202,
            sequence_id: 102,
            processing_stage: 'seq_annotation_done',
            annotation: {
              sequences_bbox: [
                {
                  is_smoke: false,
                  false_positive_types: ['antenna'],
                  bboxes: [{ detection_id: 2, xyxyn: [0, 0, 1, 1] }],
                },
              ],
            },
          }),
        },
      ],
    };
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(fullyLockedDetail);

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    expect(screen.getAllByRole('button', { name: /^Submit$/i })[0]).toBeDisabled();
  });

  it('routes alert-level missed smoke to the first still-open lane when the primary lane is already locked', async () => {
    const lockedPrimaryDetail: AlertDetail = {
      ...makeAlertDetail(),
      lanes: [
        {
          sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
          annotation: makeAnnotation({
            id: 201,
            sequence_id: 101,
            processing_stage: 'annotated',
            has_smoke: true,
            annotation: {
              sequences_bbox: [
                {
                  is_smoke: true,
                  smoke_type: 'wildfire',
                  false_positive_types: [],
                  bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
                },
              ],
            },
          }),
        },
        {
          sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
          annotation: makeAnnotation({ id: 202, sequence_id: 102 }), // ready_to_annotate, unselected
        },
      ],
    };
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(lockedPrimaryDetail);
    vi.mocked(apiClient.classifySubmit).mockResolvedValue({
      results: [
        {
          annotation_id: 202,
          sequence_id: 102,
          processing_stage: 'annotated',
          group_propagation_warning: null,
        },
      ],
    });

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));

    fireEvent.click(missedSmokeChip('Yes'));

    const submitButton = screen.getAllByRole('button', { name: /^Submit$/i })[0];
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => expect(apiClient.classifySubmit).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(apiClient.classifySubmit).mock.calls[0][0] as ClassifySubmitRequest;
    expect(payload.items).toHaveLength(1); // locked primary excluded
    expect(payload.items[0].annotation_id).toBe(202);
    expect(payload.items[0].has_missed_smoke).toBe(true);

    // Drain the success path's 1s-deferred navigate so it can't leak a real
    // timer into a later test (see the comment on the previous submit test).
    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('pluralizes the workflow-completion toast correctly for a single alert', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const cardA = openRow('101:0');
    fireEvent.click(cardA.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardA.getByRole('radio', { name: 'Wildfire' }));

    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));

    fireEvent.click(missedSmokeChip('No'));
    fireEvent.click(screen.getAllByRole('button', { name: /^Submit$/i })[0]);

    await waitFor(() => expect(apiClient.classifySubmit).toHaveBeenCalledTimes(1));
    // No active workflow in this test (annotationWorkflow defaults to null
    // in the real store), so a successful submit takes the
    // "workflow completed" branch after its 1s toast delay.
    await waitFor(
      () => expect(screen.getByText('Workflow completed! Classified 1 alert.')).toBeInTheDocument(),
      { timeout: 2000 }
    );
  });

  it('shows an error toast (with server detail) and does not navigate when submit fails', async () => {
    vi.mocked(apiClient.classifySubmit).mockRejectedValueOnce({
      response: { data: { detail: 'Lane 103 is locked' } },
    });

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const cardA = openRow('101:0');
    fireEvent.click(cardA.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardA.getByRole('radio', { name: 'Wildfire' }));

    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));

    fireEvent.click(missedSmokeChip('No'));
    fireEvent.click(screen.getAllByRole('button', { name: /^Submit$/i })[0]);

    await waitFor(() =>
      expect(screen.getByText(/Submit failed: Lane 103 is locked/)).toBeInTheDocument()
    );
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('invalidates and refetches alert-detail after a submit that returns a group-propagation warning, so submitted lanes re-render locked', async () => {
    const initialDetail = makeAlertDetail();
    const refetchedDetail: AlertDetail = {
      ...initialDetail,
      lanes: [
        {
          sequence: initialDetail.lanes[0].sequence,
          annotation: makeAnnotation({
            id: 201,
            sequence_id: 101,
            processing_stage: 'seq_annotation_done',
            has_smoke: true,
            annotation: {
              sequences_bbox: [
                {
                  is_smoke: true,
                  smoke_type: 'wildfire',
                  false_positive_types: [],
                  bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
                },
              ],
            },
          }),
        },
        {
          sequence: initialDetail.lanes[1].sequence,
          annotation: makeAnnotation({
            id: 202,
            sequence_id: 102,
            processing_stage: 'annotated',
            annotation: {
              sequences_bbox: [
                {
                  is_smoke: false,
                  false_positive_types: ['antenna'],
                  bboxes: [{ detection_id: 2, xyxyn: [0, 0, 1, 1] }],
                },
              ],
            },
          }),
        },
        initialDetail.lanes[2],
      ],
    };

    vi.mocked(apiClient.getAlertDetail)
      .mockResolvedValueOnce(initialDetail)
      .mockResolvedValueOnce(refetchedDetail);

    vi.mocked(apiClient.classifySubmit).mockResolvedValueOnce({
      results: [
        {
          annotation_id: 201,
          sequence_id: 101,
          processing_stage: 'seq_annotation_done',
          group_propagation_warning: 'Sibling sequence already carries a different label',
        },
        {
          annotation_id: 202,
          sequence_id: 102,
          processing_stage: 'annotated',
          group_propagation_warning: null,
        },
      ],
    });

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const cardA = openRow('101:0');
    fireEvent.click(cardA.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardA.getByRole('radio', { name: 'Wildfire' }));

    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));

    fireEvent.click(missedSmokeChip('No'));
    fireEvent.click(screen.getAllByRole('button', { name: /^Submit$/i })[0]);

    await waitFor(() => expect(screen.getByText(/Group propagation skipped/)).toBeInTheDocument());

    // The submitted lanes are still on screen (no auto-advance on the
    // warning path) — the page must refetch alert-detail so they redraw
    // locked/read-only instead of staying editable with stale state. Row
    // 102 was left active by the interactions above; once its lane comes
    // back locked its chips must unmount, and both lanes' new stage badges
    // must render.
    await waitFor(() => expect(apiClient.getAlertDetail).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('object-card-102:0')).queryByRole('radio', {
          name: 'False positive',
        })
      ).not.toBeInTheDocument()
    );
    expect(
      within(screen.getByTestId('object-card-101:0')).getByText('Awaiting localization')
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('object-card-102:0')).getByText('Fully annotated')
    ).toBeInTheDocument();
  });

  it('gives every object a distinct color, matching between its row swatch and the shared player overlay', async () => {
    // Each lane's own detections carry the recorded_at the page joins its
    // track boxes against — lane A and B share a frame (t1), lane C only
    // has a later frame (t2), matching each lane's makeAnnotation bboxes
    // (detection_id 1, 2, 3 respectively).
    vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (sequenceId: number) => {
      const bySequence: Record<number, { id: number; recorded_at: string }> = {
        101: { id: 1, recorded_at: '2026-01-01T10:00:00Z' },
        102: { id: 2, recorded_at: '2026-01-01T10:00:00Z' },
        103: { id: 3, recorded_at: '2026-01-01T10:00:05Z' },
      };
      const d = bySequence[sequenceId];
      return [
        {
          id: d.id,
          sequence_id: sequenceId,
          alert_api_id: 9000 + sequenceId,
          created_at: '2026-01-01T09:00:00Z',
          recorded_at: d.recorded_at,
          algo_predictions: { predictions: [] },
          last_modified_at: null,
        },
      ];
    });

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId('object-color-swatch-101:0')).toBeInTheDocument();
      expect(screen.getByTestId('object-color-swatch-102:0')).toBeInTheDocument();
      expect(screen.getByTestId('object-color-swatch-103:0')).toBeInTheDocument();
    });

    // Every object gets its own color, matching row swatch <-> palette index.
    expect(screen.getByTestId('object-color-swatch-101:0')).toHaveStyle({
      backgroundColor: getObjectColor(0),
    });
    expect(screen.getByTestId('object-color-swatch-102:0')).toHaveStyle({
      backgroundColor: getObjectColor(1),
    });
    expect(screen.getByTestId('object-color-swatch-103:0')).toHaveStyle({
      backgroundColor: getObjectColor(2),
    });

    // The whole-alert player only mounts once the missed-smoke section is
    // active — activate it so the (mocked) reviewer starts receiving the
    // objectOverlays prop.
    fireEvent.click(screen.getByTestId('missed-smoke-row'));

    // `objectOverlaysSpy` is called on every render of the (mocked)
    // reviewer, including earlier ones where the three lanes'
    // `getSequenceDetections` queries haven't all resolved yet — waiting
    // for "called at least once" and then reading `.at(-1)` right after
    // can race an in-flight query. Wait for the actual settled content
    // (object 3's later-frame box, only present once its detections query
    // has resolved) so `.at(-1)` is guaranteed to be the final call.
    type Overlay = { color: string; label: string; boxesByRecordedAt: Record<string, unknown> };
    await waitFor(() => {
      const overlays = objectOverlaysSpy.mock.calls.at(-1)?.[0] as Overlay[] | undefined;
      expect(overlays?.[2]?.boxesByRecordedAt).toHaveProperty('2026-01-01T10:00:05Z');
    });
    const lastOverlays = objectOverlaysSpy.mock.calls.at(-1)![0] as Overlay[];

    expect(lastOverlays.map(o => o.label)).toEqual(['Object 1', 'Object 2', 'Object 3']);
    // Colors match the row swatches for the same object, in the same order.
    expect(lastOverlays[0].color).toBe(getObjectColor(0));
    expect(lastOverlays[1].color).toBe(getObjectColor(1));
    expect(lastOverlays[2].color).toBe(getObjectColor(2));
    // Object 1 and 2 share frame t1; object 3 only has t2.
    expect(lastOverlays[0].boxesByRecordedAt).toHaveProperty('2026-01-01T10:00:00Z');
    expect(lastOverlays[1].boxesByRecordedAt).toHaveProperty('2026-01-01T10:00:00Z');
    expect(lastOverlays[2].boxesByRecordedAt).toHaveProperty('2026-01-01T10:00:05Z');
    expect(lastOverlays[2].boxesByRecordedAt).not.toHaveProperty('2026-01-01T10:00:00Z');
  });

  /**
   * Detections fixture shared by the row-timeline tests: lane 101 captured
   * on t1+t2, lanes 102/103 on t1 only — union [t1, t2], with lane 101's
   * track bbox only referencing t1's detection.
   */
  function mockRowTimelineDetections() {
    const t1 = '2026-01-01T10:00:00Z';
    const t2 = '2026-01-01T10:00:05Z';
    vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (sequenceId: number) => {
      const bySequence: Record<number, { id: number; recorded_at: string }[]> = {
        101: [
          { id: 1, recorded_at: t1 },
          { id: 4, recorded_at: t2 }, // no bbox references this detection
        ],
        102: [{ id: 2, recorded_at: t1 }],
        103: [{ id: 3, recorded_at: t1 }],
      };
      return bySequence[sequenceId].map(d => ({
        id: d.id,
        sequence_id: sequenceId,
        alert_api_id: 9000 + sequenceId,
        created_at: '2026-01-01T09:00:00Z',
        recorded_at: d.recorded_at,
        algo_predictions: { predictions: [] },
        last_modified_at: null,
      }));
    });
  }

  it('row timeline fills a frame where the lane has a detection but the object has no track bbox on it', async () => {
    // Lane A (101) is captured on two frames (t1, t2), but its track's
    // annotation bbox only references detection_id 1 (t1). The lane still
    // *has a detection* at t2, so the row's strip (unlike the track-box
    // overlay) must render that frame filled, not a gap.
    mockRowTimelineDetections();

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    // Frame union across all 3 objects sorts to [t1, t2] -> segment index 0
    // = t1, index 1 = t2. Object 1's lane has a detection at t2, so its
    // second segment renders filled even without a track bbox there.
    await waitFor(() =>
      expect(screen.getByTestId('frame-segment-101:0-1')).toHaveStyle({
        backgroundColor: getObjectColor(0),
      })
    );
  });

  it("plays the alert's full frame union for the active object, including frames its own track has no box on", async () => {
    // Same shape as the presence-strip fixture: lane 101 is captured on two
    // frames (t1, t2) but its track only references detection 1 (t1) —
    // the full-frame player must still play both frames.
    const t1 = '2026-01-01T10:00:00Z';
    const t2 = '2026-01-01T10:00:05Z';
    vi.mocked(apiClient.getSequenceDetections).mockImplementation(async (sequenceId: number) => {
      const bySequence: Record<number, { id: number; recorded_at: string }[]> = {
        101: [
          { id: 1, recorded_at: t1 },
          { id: 4, recorded_at: t2 },
        ],
        102: [{ id: 2, recorded_at: t1 }],
        103: [{ id: 3, recorded_at: t1 }],
      };
      return bySequence[sequenceId].map(d => ({
        id: d.id,
        sequence_id: sequenceId,
        alert_api_id: 9000 + sequenceId,
        created_at: '2026-01-01T09:00:00Z',
        recorded_at: d.recorded_at,
        algo_predictions: { predictions: [] },
        last_modified_at: null,
      }));
    });

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    // Union is [t1, t2] -> 2 frames handed to the player, though the active
    // track only has 1 box.
    await waitFor(() =>
      expect(screen.getByTestId('full-image-sequence').getAttribute('data-bbox-count')).toBe('2')
    );
  });

  it('renders the timeline legend in the rail with classify wording', async () => {
    mockRowTimelineDetections();

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const legend = await screen.findByTestId('classify-timeline-legend');
    expect(screen.getByTestId('classify-media-panel').contains(legend)).toBe(false);
    expect(within(legend).getByTestId('legend-chip-confirmed')).toHaveTextContent('Detected');
    // Lanes 102/103 miss the union frame t2, so the bare-track state is named.
    expect(within(legend).getByTestId('legend-chip-absent')).toHaveTextContent('Not on this frame');
  });

  it('clicking a timeline segment on another row activates that card', async () => {
    mockRowTimelineDetections();

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    // Lane B (sequence 102) is "Object 2" — see makeAlertDetail's laneB.
    fireEvent.click(await screen.findByTestId('frame-segment-102:0-0'));

    // The page owns turning the segment click into "activate that row":
    // Object 2's row expands its chips exactly as a direct row click would,
    // and no other row is expanded. (No scroll: the clicked row is already
    // under the pointer — unlike the old below-the-rail strip rows.)
    await waitFor(() =>
      expect(
        within(screen.getByTestId('object-card-102:0')).getByRole('radio', { name: 'Smoke' })
      ).toBeInTheDocument()
    );
    expect(
      within(screen.getByTestId('object-card-101:0')).queryByRole('radio', { name: 'Smoke' })
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('object-card-103:0')).queryByRole('radio', { name: 'Smoke' })
    ).not.toBeInTheDocument();
  });

  it('clicking a segment seeks the player to that frame, and a repeat click re-seeks', async () => {
    mockRowTimelineDetections();

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    fireEvent.click(await screen.findByTestId('frame-segment-101:0-1'));
    const player = () => screen.getByTestId('full-image-sequence');
    expect(player().getAttribute('data-seek-index')).toBe('1');
    expect(player().getAttribute('data-seek-nonce')).toBe('1');

    // Same segment again: the nonce bumps so the player re-seeks.
    fireEvent.click(screen.getByTestId('frame-segment-101:0-1'));
    expect(player().getAttribute('data-seek-nonce')).toBe('2');
  });

  it('an expired seek request does not replay when the player remounts', async () => {
    mockRowTimelineDetections();

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    fireEvent.click(await screen.findByTestId('frame-segment-101:0-0'));
    expect(screen.getByTestId('full-image-sequence').getAttribute('data-seek-nonce')).toBe('1');

    // Swap the media panel to the whole-alert player (unmounts the
    // full-frame player), let the 2 s hold window lapse, and swap back:
    // the remounted player must receive no seek request — otherwise it
    // would replay the stale jump-and-hold.
    fireEvent.click(screen.getByTestId('missed-smoke-row'));
    await waitFor(
      () => {
        fireEvent.click(screen.getByTestId('object-card-101:0'));
        expect(
          screen.getByTestId('full-image-sequence').getAttribute('data-seek-nonce')
        ).toBeNull();
      },
      { timeout: 4000 }
    );
  });

  it('a single-object alert still shows its row timeline', async () => {
    // The old presence strip hid itself under 2 objects; the inline strips don't.
    const detail = makeAlertDetail();
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue({ ...detail, lanes: [detail.lanes[0]] });
    mockRowTimelineDetections();

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    expect(await screen.findByTestId('object-timeline-101:0')).toBeInTheDocument();
  });

  it('a locked row still shows its timeline', async () => {
    // Lane C (103) is 'annotated' -> locked in queue mode; its strip is
    // informational and renders anyway.
    mockRowTimelineDetections();

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    expect(await screen.findByTestId('object-timeline-103:0')).toBeInTheDocument();
  });

  it('auto-activates the first editable object on load', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });
    // Chips only render on the active row — their presence proves activation.
    const row = within(screen.getByTestId('object-card-101:0'));
    expect(row.getByRole('radio', { name: 'Smoke' })).toBeInTheDocument();
    expect(
      within(screen.getByTestId('object-card-102:0')).queryByRole('radio', { name: 'Smoke' })
    ).not.toBeInTheDocument();
  });

  it('clicking another row moves the chips and the media panel to it', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    fireEvent.click(screen.getByTestId('object-card-102:0'));

    expect(
      within(screen.getByTestId('object-card-102:0')).getByRole('radio', { name: 'Smoke' })
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('object-card-101:0')).queryByRole('radio', { name: 'Smoke' })
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('object-media').getAttribute('data-object-label')).toBe('Object 2');
  });

  it('activating the missed-smoke row swaps the media panel to the whole-alert player, and an object row swaps it back', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    expect(screen.queryByTestId('sequence-reviewer')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('missed-smoke-row'));
    expect(screen.getByTestId('sequence-reviewer')).toBeInTheDocument();
    expect(screen.queryByTestId('cropped-image-sequence')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('object-card-101:0'));
    expect(screen.queryByTestId('sequence-reviewer')).not.toBeInTheDocument();
    expect(screen.getByTestId('cropped-image-sequence')).toBeInTheDocument();
  });

  it('mirrors Submit in the rail below the missed-smoke row, tracking the same enablement, and submits from there', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const railSubmit = screen.getByTestId('rail-submit');
    // Sits after the missed-smoke row in document order.
    expect(
      screen.getByTestId('missed-smoke-row').compareDocumentPosition(railSubmit) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(railSubmit).toBeDisabled();

    const cardA = openRow('101:0');
    fireEvent.click(cardA.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardA.getByRole('radio', { name: 'Wildfire' }));
    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));
    expect(railSubmit).toBeDisabled();

    fireEvent.click(missedSmokeChip('No'));
    expect(railSubmit).not.toBeDisabled();

    fireEvent.click(railSubmit);
    await waitFor(() => expect(apiClient.classifySubmit).toHaveBeenCalledTimes(1));

    // Drain the success path's deferred navigate (see the submit tests above).
    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('focuses the active row on load so Tab cycles the rail immediately', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('object-card-101:0')).toHaveFocus());
  });

  it('Tab cycles rows -> missed smoke and wraps both ways, never escaping the rail; the disabled submit is skipped until enabled', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });
    await waitFor(() => expect(screen.getByTestId('object-card-101:0')).toHaveFocus());

    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByTestId('object-card-102:0')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByTestId('object-card-103:0')).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByTestId('missed-smoke-row')).toHaveFocus();
    // Submit is disabled (nothing classified) so the cycle wraps straight
    // back to the first row instead of escaping the rail.
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(screen.getByTestId('object-card-101:0')).toHaveFocus();
    // Backward from the first row wraps to the missed-smoke row.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(screen.getByTestId('missed-smoke-row')).toHaveFocus();

    // Classify everything — the now-enabled submit joins the cycle.
    const cardA = openRow('101:0');
    fireEvent.click(cardA.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardA.getByRole('radio', { name: 'Wildfire' }));
    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));
    fireEvent.click(missedSmokeChip('No'));

    fireEvent.keyDown(document, { key: 'Tab' }); // 102 -> 103 (row 102 was last activated by openRow's click? focus is unchanged by clicks in jsdom)
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'Tab' });
    // Wherever the cycle started, within four Tabs it must reach the
    // enabled submit without ever leaving the rail.
    fireEvent.keyDown(document, { key: 'Tab' });
    const focusable = [
      screen.getByTestId('object-card-101:0'),
      screen.getByTestId('object-card-102:0'),
      screen.getByTestId('object-card-103:0'),
      screen.getByTestId('missed-smoke-row'),
      screen.getByTestId('rail-submit'),
    ];
    expect(focusable).toContain(document.activeElement);
    // Cycle a full loop: the enabled submit must be visited.
    const visited = new Set<Element | null>();
    for (let i = 0; i < 5; i += 1) {
      visited.add(document.activeElement);
      fireEvent.keyDown(document, { key: 'Tab' });
    }
    expect(visited.has(screen.getByTestId('rail-submit'))).toBe(true);
  });

  it('U toggles unsure on the active object, mutually exclusive with S', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    fireEvent.keyDown(document, { key: 'u' });
    const row = within(screen.getByTestId('object-card-101:0'));
    expect(row.getByRole('radio', { name: 'Unsure' })).toBeChecked();

    fireEvent.keyDown(document, { key: 's' });
    expect(row.getByRole('radio', { name: 'Unsure' })).not.toBeChecked();
    expect(row.getByRole('radio', { name: 'Smoke' })).toBeChecked();
  });

  it('classification shortcuts are inert while the missed-smoke section is active', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    fireEvent.click(screen.getByTestId('missed-smoke-row'));
    fireEvent.keyDown(document, { key: 'f' });

    // Back to the object view: the active object was never classified.
    fireEvent.click(screen.getByTestId('object-card-101:0'));
    const row = within(screen.getByTestId('object-card-101:0'));
    expect(row.getByRole('radio', { name: 'False positive' })).not.toBeChecked();
    expect(row.getByText('Pending')).toBeInTheDocument();
  });

  it('blocks re-submission during the post-submit window and invalidates the cached alert detail', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const cardA = openRow('101:0');
    fireEvent.click(cardA.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardA.getByRole('radio', { name: 'Wildfire' }));
    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));
    fireEvent.click(missedSmokeChip('No'));

    fireEvent.keyDown(document, { key: 'Enter' });
    await waitFor(() => expect(apiClient.classifySubmit).toHaveBeenCalledTimes(1));

    // Enter again inside the 1s auto-advance window must not re-submit the
    // already-submitted lanes.
    fireEvent.keyDown(document, { key: 'Enter' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(apiClient.classifySubmit).toHaveBeenCalledTimes(1);

    // The success path invalidates the alert-detail cache (5-minute global
    // staleTime would otherwise re-serve the PRE-submit lanes to
    // /classify/done/:id) — the still-mounted query refetches.
    await waitFor(() => expect(apiClient.getAlertDetail).toHaveBeenCalledTimes(2));

    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('auto-advances to the next alert in the classify queue after submit when no table workflow is active', async () => {
    vi.mocked(apiClient.getClassifyQueue).mockResolvedValue({
      items: [
        {
          source_api: 'pyronear_french',
          platform_alert_id: 900,
          camera_name: 'CAM-2',
          organisation_name: 'Org',
          azimuth: null,
          recorded_at: '2026-01-01T11:00:00Z',
          is_wildfire_alertapi: null,
          primary_sequence_id: 555,
          total_objects: 1,
          classified_objects: 0,
        },
      ],
      page: 1,
      pages: 1,
      size: 2,
      total: 1,
    });

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const cardA = openRow('101:0');
    fireEvent.click(cardA.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardA.getByRole('radio', { name: 'Wildfire' }));
    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'False positive' }));
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Antenna' }));
    fireEvent.click(missedSmokeChip('No'));

    fireEvent.click(screen.getAllByRole('button', { name: /^Submit$/i })[0]);
    await waitFor(() => expect(apiClient.classifySubmit).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/classify/555'), {
      timeout: 2000,
    });
  });

  it('shows the FP type chips as a full inline wrap on the active row', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const row = openRow('101:0');
    fireEvent.click(row.getByRole('radio', { name: 'False positive' }));
    // 18 FP type chips (Unsure is a radio in the exclusive group).
    expect(row.getAllByRole('checkbox')).toHaveLength(18);
  });
});

describe('ClassifyAlertPage done mode', () => {
  // Two genuinely-labeled lanes at "done" stages (seq_annotation_done /
  // annotated) plus one not-yet-imported placeholder lane — done mode's
  // locked test is "has an annotation at all", not stage, so both labeled
  // lanes must render editable regardless of already being past
  // ready_to_annotate; the placeholder stays locked exactly as in queue mode.
  function makeDoneAlertDetail(): AlertDetail {
    const laneA = {
      sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
      annotation: makeAnnotation({
        id: 201,
        sequence_id: 101,
        processing_stage: 'seq_annotation_done',
        has_smoke: true,
        has_missed_smoke: false,
        annotation: {
          sequences_bbox: [
            {
              is_smoke: true,
              smoke_type: 'wildfire',
              false_positive_types: [],
              bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
            },
          ],
        },
      }),
    };
    const laneB = {
      sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
      annotation: makeAnnotation({
        id: 202,
        sequence_id: 102,
        processing_stage: 'annotated',
        annotation: {
          sequences_bbox: [
            {
              is_smoke: false,
              false_positive_types: ['antenna'],
              bboxes: [{ detection_id: 2, xyxyn: [0, 0, 1, 1] }],
            },
          ],
        },
      }),
    };
    const laneC = {
      sequence: makeSequence({ id: 103, alert_api_id: 9003 }),
      annotation: null,
    };
    return {
      source_api: 'pyronear_french',
      platform_alert_id: 500,
      camera_name: 'CAM-1',
      organisation_name: 'Org',
      recorded_at: '2026-01-01T10:00:00Z',
      lanes: [laneA, laneB, laneC],
    };
  }

  // Three genuinely-labeled, editable lanes — used by the sequential-PATCH
  // abort test, which needs a third lane whose PATCH must never fire.
  function makeThreeLaneDoneAlertDetail(): AlertDetail {
    const laneA = {
      sequence: makeSequence({ id: 101, alert_api_id: 9001 }),
      annotation: makeAnnotation({
        id: 201,
        sequence_id: 101,
        processing_stage: 'seq_annotation_done',
        has_smoke: true,
        annotation: {
          sequences_bbox: [
            {
              is_smoke: true,
              smoke_type: 'wildfire',
              false_positive_types: [],
              bboxes: [{ detection_id: 1, xyxyn: [0, 0, 1, 1] }],
            },
          ],
        },
      }),
    };
    const laneB = {
      sequence: makeSequence({ id: 102, alert_api_id: 9002 }),
      annotation: makeAnnotation({
        id: 202,
        sequence_id: 102,
        processing_stage: 'annotated',
        annotation: {
          sequences_bbox: [
            {
              is_smoke: false,
              false_positive_types: ['antenna'],
              bboxes: [{ detection_id: 2, xyxyn: [0, 0, 1, 1] }],
            },
          ],
        },
      }),
    };
    const laneD = {
      sequence: makeSequence({ id: 104, alert_api_id: 9004 }),
      annotation: makeAnnotation({
        id: 204,
        sequence_id: 104,
        processing_stage: 'seq_annotation_done',
        has_smoke: true,
        annotation: {
          sequences_bbox: [
            {
              is_smoke: true,
              smoke_type: 'industrial',
              false_positive_types: [],
              bboxes: [{ detection_id: 4, xyxyn: [0, 0, 1, 1] }],
            },
          ],
        },
      }),
    };
    return {
      source_api: 'pyronear_french',
      platform_alert_id: 500,
      camera_name: 'CAM-1',
      organisation_name: 'Org',
      recorded_at: '2026-01-01T10:00:00Z',
      lanes: [laneA, laneB, laneD],
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(apiClient.getSequence).mockResolvedValue(makeSequence());
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(makeDoneAlertDetail());
    vi.mocked(apiClient.getSequenceDetections).mockResolvedValue([]);
    vi.mocked(apiClient.updateSequenceAnnotation).mockImplementation(async (id: number) => ({
      ...makeAnnotation({ id }),
      processing_stage: 'seq_annotation_done',
      group_propagation_warning: null,
    }));
  });

  it('renders lanes with existing annotations as editable and pre-filled, regardless of processing stage', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const cardA = within(screen.getByTestId('object-card-101:0')); // seq_annotation_done, entry-activated
    expect(cardA.getByText('Smoke · Wildfire')).toBeInTheDocument();
    // Done-mode rows are all re-editable, so no stage badge noise.
    expect(cardA.queryByText('Awaiting localization')).not.toBeInTheDocument();
    expect(cardA.getByRole('radio', { name: 'Smoke' })).not.toBeDisabled();
    expect(cardA.getByRole('radio', { name: 'Smoke' })).toBeChecked();

    const cardB = openRow('102:0'); // annotated — still editable in done mode
    expect(cardB.queryByText('Fully annotated')).not.toBeInTheDocument();
    expect(cardB.getByRole('radio', { name: 'False positive' })).not.toBeDisabled();
    expect(cardB.getByRole('radio', { name: 'False positive' })).toBeChecked();

    // The annotation-less lane still renders the read-only placeholder —
    // done mode only changes the meaning of "has an annotation", not the
    // "not imported yet" case.
    expect(screen.getByTestId('object-card-placeholder-103')).toBeInTheDocument();
    expect(screen.getByText('Not imported yet')).toBeInTheDocument();
  });

  it('keeps save disabled until a lane actually changes, even though every row is already validly classified', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const submitButton = screen.getAllByRole('button', { name: /Save changes/ })[0];
    expect(submitButton).toBeDisabled();

    // Change lane A's smoke type — a real edit.
    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: 'Industrial' }));

    expect(submitButton).not.toBeDisabled();
  });

  it('PATCHes only the changed lane via updateSequenceAnnotation, leaving the untouched lane alone', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: 'Industrial' }));

    const submitButton = screen.getAllByRole('button', { name: /Save changes/ })[0];
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledTimes(1));
    expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledWith(
      201,
      expect.objectContaining({
        processing_stage: 'seq_annotation_done',
        is_unsure: false,
      })
    );
    const [, payload] = vi.mocked(apiClient.updateSequenceAnnotation).mock.calls[0];
    expect(payload.annotation?.sequences_bbox[0].smoke_type).toBe('industrial');
    // Lane B (202) was never touched, so it must never be PATCHed.
    expect(apiClient.updateSequenceAnnotation).not.toHaveBeenCalledWith(202, expect.anything());
    expect(apiClient.classifySubmit).not.toHaveBeenCalled();

    // Drain the success path's 1s-deferred navigate so it can't leak a real
    // timer into a later test (a dangling setTimeout from here previously
    // caused a flaky failure in the "aborts on the first PATCH failure"
    // test, which asserts navigateMock was NOT called).
    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('demotes a promoted FP lane to seq_annotation_done in its PATCH (issue #275)', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    // Flip the FP lane (102 / annotation 202) to smoke + a smoke type.
    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('radio', { name: 'Smoke' }));
    fireEvent.click(cardB.getByRole('radio', { name: 'Wildfire' }));

    const submitButton = screen.getAllByRole('button', { name: /Save changes/ })[0];
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledTimes(1));
    expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledWith(
      202,
      expect.objectContaining({
        processing_stage: 'seq_annotation_done',
        has_smoke: true,
      })
    );

    // Drain the success path's deferred navigate (see the sibling PATCH test).
    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('marking a lane unsure without settling it still parks at seq_annotation_done', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: 'Unsure' }));

    fireEvent.click(screen.getAllByRole('button', { name: /Save changes/ })[0]);

    await waitFor(() => expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledTimes(1));
    expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledWith(
      201,
      expect.objectContaining({ processing_stage: 'seq_annotation_done', is_unsure: true })
    );

    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('settling an unsure lane as undecidable sends it to annotated, unblocking its alert', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: 'Unsure' }));
    fireEvent.click(cardA.getByRole('checkbox', { name: 'Undecidable for now' }));

    fireEvent.click(screen.getAllByRole('button', { name: /Save changes/ })[0]);

    await waitFor(() => expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledTimes(1));
    // is_unsure stays true — the object is settled, not decided.
    expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledWith(
      201,
      expect.objectContaining({ processing_stage: 'annotated', is_unsure: true })
    );

    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('an alert-level missed-smoke-only change makes the primary lane "changed" and is saved on its PATCH', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const submitButton = screen.getAllByRole('button', { name: /Save changes/ })[0];
    expect(submitButton).toBeDisabled();

    // No row edits at all — only the alert-level missed-smoke review changes.
    fireEvent.click(
      within(screen.getByTestId('missed-smoke-row')).getByRole('radio', { name: 'Yes' })
    );
    expect(submitButton).not.toBeDisabled();

    fireEvent.click(submitButton);

    await waitFor(() => expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledTimes(1));
    expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledWith(
      201,
      expect.objectContaining({ has_missed_smoke: true })
    );

    // Drain the success path's 1s-deferred navigate — see the comment on
    // the previous test for why this matters.
    await waitFor(() => expect(navigateMock).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('activates the clicked object on load (chips expand on its row, not the primary)', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(102) });

    await waitFor(() =>
      expect(
        within(screen.getByTestId('object-card-102:0')).getByRole('radio', {
          name: 'False positive',
        })
      ).toBeInTheDocument()
    );
    expect(
      within(screen.getByTestId('object-card-101:0')).queryByRole('radio', { name: 'Smoke' })
    ).not.toBeInTheDocument();
  });

  it('aborts on the first PATCH failure: the earlier lane stays patched, the later lane is never attempted, error toast, no navigation', async () => {
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(makeThreeLaneDoneAlertDetail());
    vi.mocked(apiClient.updateSequenceAnnotation)
      .mockResolvedValueOnce({
        ...makeAnnotation({ id: 201 }),
        processing_stage: 'seq_annotation_done',
        group_propagation_warning: null,
      })
      .mockRejectedValueOnce({ response: { data: { detail: 'Lane 202 rejected' } } });

    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    // Change all three lanes so all three land in changedLanes — proving the
    // loop is sequential (not Promise.all firing every lane at once) and
    // that it stops immediately on the first rejection.
    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: 'Industrial' }));

    const cardB = openRow('102:0');
    fireEvent.click(cardB.getByRole('checkbox', { name: 'Building' }));

    const cardD = openRow('104:0');
    fireEvent.click(cardD.getByRole('radio', { name: 'Wildfire' }));

    const submitButton = screen.getAllByRole('button', { name: /Save changes/ })[0];
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    await waitFor(() => expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledTimes(2));
    expect(apiClient.updateSequenceAnnotation).toHaveBeenNthCalledWith(1, 201, expect.anything());
    expect(apiClient.updateSequenceAnnotation).toHaveBeenNthCalledWith(2, 202, expect.anything());
    // The third (changed) lane's PATCH must never fire once lane 202 rejected.
    expect(apiClient.updateSequenceAnnotation).not.toHaveBeenCalledWith(204, expect.anything());

    await waitFor(() =>
      expect(screen.getByText(/Submit failed: Lane 202 rejected/)).toBeInTheDocument()
    );
    expect(navigateMock).not.toHaveBeenCalled();

    // onError refetches alert-detail so lane 201 (already patched on the
    // server) redraws with server truth rather than staying on stale local state.
    await waitFor(() => expect(apiClient.getAlertDetail).toHaveBeenCalledTimes(2));
  });

  it('shows the changed dot on edited rows and counts changed lanes in the Save button', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    expect(screen.getAllByRole('button', { name: /Save changes \(0\)/ })[0]).toBeDisabled();
    expect(screen.queryByTestId('object-row-changed-101:0')).not.toBeInTheDocument();

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: 'Industrial' }));

    expect(screen.getByTestId('object-row-changed-101:0')).toBeInTheDocument();
    expect(screen.queryByTestId('object-row-changed-102:0')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Save changes \(1\)/ })[0]).toBeEnabled();
  });

  describe('return trip from localize', () => {
    const RETURN_SEARCH = `?return=${encodeURIComponent('/localize/101')}`;

    afterEach(() => {
      useSequenceStore.getState().clearAnnotationWorkflow();
    });

    it('sends the back button to the return target instead of the Done list', async () => {
      await renderAndSettle(<ClassifyAlertPage mode="done" />, {
        wrapper: makeDoneWrapper(101, RETURN_SEARCH),
      });

      fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));

      expect(navigateMock).toHaveBeenCalledWith('/localize/101');
    });

    it('returns to the localize page after saving, even with a stale workflow in the store', async () => {
      // The exact hazard the skip exists for: an annotationWorkflow left in
      // the store by an earlier classify session. Without the short-circuit,
      // getNextSequenceInWorkflow() hands back sequence 999 and the save
      // navigates there instead of back to localize.
      useSequenceStore
        .getState()
        .startAnnotationWorkflow([makeSequence({ id: 101 }), makeSequence({ id: 999 })], 101, {});

      await renderAndSettle(<ClassifyAlertPage mode="done" />, {
        wrapper: makeDoneWrapper(101, RETURN_SEARCH),
      });

      const cardA = within(screen.getByTestId('object-card-101:0'));
      fireEvent.click(cardA.getByRole('radio', { name: 'Industrial' }));

      const submitButton = screen.getAllByRole('button', { name: /Save changes/ })[0];
      fireEvent.click(submitButton);

      await waitFor(() => expect(apiClient.updateSequenceAnnotation).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/localize/101'), {
        timeout: 2000,
      });
      expect(navigateMock).not.toHaveBeenCalledWith('/classify/done/999');
    });

    it('ignores an off-site return target and falls back to the Done list', async () => {
      await renderAndSettle(<ClassifyAlertPage mode="done" />, {
        wrapper: makeDoneWrapper(101, `?return=${encodeURIComponent('//evil.example.com')}`),
      });

      fireEvent.click(screen.getByRole('button', { name: /Alerts/ }));

      expect(navigateMock).toHaveBeenCalledWith('/classify/done');
    });
  });

  describe('skip alert', () => {
    it('opens the confirm dialog with an optional note field', async () => {
      await renderAndSettle(<ClassifyAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Skip alert/ }));

      expect(screen.getByTestId('skip-alert-confirm')).toBeInTheDocument();
      expect(screen.getByLabelText(/optional/i)).toBeInTheDocument();
    });

    it('the close cross dismisses without calling the API', async () => {
      await renderAndSettle(<ClassifyAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Skip alert/ }));
      fireEvent.click(
        within(screen.getByTestId('skip-alert-confirm')).getByRole('button', { name: 'Close' })
      );

      expect(screen.queryByTestId('skip-alert-confirm')).not.toBeInTheDocument();
      expect(apiClient.skipAlert).not.toHaveBeenCalled();
    });

    it('confirm sends the trimmed note and advances', async () => {
      vi.mocked(apiClient.skipAlert).mockResolvedValue({
        skipped_at: '2026-08-05T10:00:00Z',
        skipped_by: 'annotator',
        note: 'hard to split',
      });
      await renderAndSettle(<ClassifyAlertPage />, { wrapper });

      fireEvent.click(screen.getByRole('button', { name: /Skip alert/ }));
      fireEvent.change(screen.getByLabelText(/optional/i), {
        target: { value: '  hard to split  ' },
      });
      fireEvent.click(
        within(screen.getByTestId('skip-alert-confirm')).getByRole('button', {
          name: /Skip alert/,
        })
      );

      await waitFor(() => {
        expect(apiClient.skipAlert).toHaveBeenCalledWith('pyronear_french', 500, 'hard to split');
      });
      // Default queue mock is empty, so the advance falls back to the queue list.
      await waitFor(() => {
        expect(navigateMock).toHaveBeenCalledWith('/classify');
      });
    });

    it('shows an error toast and keeps the dialog when the skip fails', async () => {
      vi.mocked(apiClient.skipAlert).mockRejectedValue({ detail: 'Alert is already skipped' });
      await renderAndSettle(<ClassifyAlertPage />, { wrapper });

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
      expect(navigateMock).not.toHaveBeenCalled();
    });

    it('does not offer skip in done mode', async () => {
      await renderAndSettle(<ClassifyAlertPage mode="done" />, {
        wrapper: makeDoneWrapper(101),
      });

      expect(screen.queryByRole('button', { name: /Skip alert/ })).not.toBeInTheDocument();
    });
  });
});
