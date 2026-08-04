/**
 * Tests for ClassifyAlertPage: the collocated classify screen that renders
 * every object (lane) of one alert and submits them all in a single
 * classifySubmit call.
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
  },
}));

const navigateMock = vi.fn();
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => navigateMock };
});

vi.mock('@/components/annotation/FullImageSequence', () => ({
  default: () => <div data-testid="full-image-sequence" />,
}));
vi.mock('@/components/annotation/CroppedImageSequence', () => ({
  default: () => <div data-testid="cropped-image-sequence" />,
}));

// The primary-lane player (SequenceReviewer -> SequencePlayer) fetches
// detections and renders a full playback UI unrelated to this page's own
// logic; swap it for a trivial stand-in that exposes the missed-smoke
// review callback so tests can drive it directly. `objectOverlaysSpy`
// captures the `objectOverlays` prop the page builds for it so overlay
// wiring can be asserted without rendering the real player.
const objectOverlaysSpy = vi.fn();
vi.mock('@/components/sequence-annotation', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/sequence-annotation')>();
  return {
    ...actual,
    MissedSmokePanel: ({
      onMissedSmokeReviewChange,
      objectOverlays,
    }: {
      onMissedSmokeReviewChange: (review: 'yes' | 'no') => void;
      objectOverlays?: unknown;
    }) => {
      objectOverlaysSpy(objectOverlays);
      return (
        <div>
          <button onClick={() => onMissedSmokeReviewChange('no')}>Mock: No missed smoke</button>
          <button onClick={() => onMissedSmokeReviewChange('yes')}>Mock: Missed smoke</button>
        </div>
      );
    },
  };
});

import { apiClient } from '@/services/api';
import ClassifyAlertPage from '@/pages/ClassifyAlertPage';

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
function makeDoneWrapper(entrySequenceId: number) {
  return function DoneWrapper({ children }: { children: React.ReactNode }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/classify/done/${entrySequenceId}`]}>
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
 * Renders the page and waits for card 101:0's SEEDED state to have
 * committed — not just its presence. Used by every test in this file
 * instead of `render(...)` + a bare `waitFor(testid present)`.
 *
 * The page settles in two separate React commits: (1) alert-detail
 * arrives and `renderItems`/cards render structurally (testid, "Object N"
 * title, locked/disabled attributes — all derived straight from
 * `alertDetail`), then (2) a *separate* `useEffect`
 * (`initializeFromAlertDetail`) seeds classification/bbox/unsure/missed-
 * smoke local state from that same data — which is what actually drives
 * checked radios, Reviewed/Pending badges, displayed smoke/FP text, and
 * bbox counts. Under slow/CI scheduling, `waitFor` can observe the DOM in
 * the gap between those two commits: a card can be "present" with none of
 * its seeded content painted yet. This caused two separate CI-only test
 * failures (asserting a radio was checked / "Reviewed" was rendered
 * immediately after only waiting for the card's testid). Interacting with
 * a card before commit (2) lands is also unsafe for a different reason:
 * click handlers spread the CURRENT bbox prop, which is still the
 * `EMPTY_BBOX` placeholder pre-commit-(2), silently discarding the card's
 * real bbox data.
 *
 * Every real lane in every fixture in this file seeds >= 1 bbox entry,
 * and a card's bbox-count text reads the `EMPTY_BBOX` default
 * ("0 bboxes") until commit (2) lands — so waiting for card 101's count to
 * move off "0 bboxes" is a settle signal common to every scenario here
 * (editable, locked, or alongside an unrelated placeholder lane), without
 * depending on any particular classification outcome.
 */
async function renderAndSettle(
  ui: React.ReactElement,
  options: { wrapper: React.ComponentType<{ children: React.ReactNode }> }
): Promise<void> {
  render(ui, options);
  await waitFor(() => {
    const card = within(screen.getByTestId('object-card-101:0'));
    expect(card.queryByText('0 bboxes')).not.toBeInTheDocument();
  });
}

describe('ClassifyAlertPage', () => {
  beforeEach(() => {
    // Clears call counts (not just implementations) so per-test assertions
    // like `toHaveBeenCalledTimes` aren't polluted by earlier tests' calls.
    vi.clearAllMocks();
    // jsdom doesn't implement scrollIntoView; the presence-strip click
    // handler calls it on the target card, so stub it as a no-op.
    Element.prototype.scrollIntoView = vi.fn();
    vi.mocked(apiClient.getSequence).mockResolvedValue(makeSequence());
    vi.mocked(apiClient.getAlertDetail).mockResolvedValue(makeAlertDetail());
    // Default: no detections, so overlay-building code has something to
    // resolve against without erroring; overridden per-test where the
    // overlay content itself is under test.
    vi.mocked(apiClient.getSequenceDetections).mockResolvedValue([]);
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

  it('renders one card per lane-track for a 3-lane alert', async () => {
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

  it('renders the locked lane card read-only with a stage badge', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const lockedCard = within(screen.getByTestId('object-card-103:0'));
    expect(lockedCard.getByText('Fully annotated')).toBeInTheDocument();
    expect(lockedCard.getByRole('radio', { name: /This is smoke/i })).toBeDisabled();
    // Its existing (already-submitted) classification renders, not blank.
    expect(lockedCard.getByRole('radio', { name: /This is smoke/i })).toBeChecked();
    expect(lockedCard.getAllByText(/Wildfire/).length).toBeGreaterThan(0);

    const editableCard = within(screen.getByTestId('object-card-101:0'));
    expect(editableCard.getByRole('radio', { name: /This is smoke/i })).not.toBeDisabled();
  });

  it('disables submit until every editable card is classified and missed smoke is answered', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const submitButton = screen.getByRole('button', { name: /Submit alert/i });
    expect(submitButton).toBeDisabled();

    // Classify object 1 as smoke + wildfire
    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: /This is smoke/i }));
    fireEvent.click(cardA.getByRole('radio', { name: /Wildfire/i }));

    expect(submitButton).toBeDisabled();

    // Classify object 2 as false positive + a type
    const cardB = within(screen.getByTestId('object-card-102:0'));
    fireEvent.click(cardB.getByRole('radio', { name: /false positive/i }));
    fireEvent.click(cardB.getByRole('checkbox', { name: /Antenna/i }));

    // Still missing the missed-smoke review
    expect(submitButton).toBeDisabled();

    fireEvent.click(screen.getByText('Mock: No missed smoke'));

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

    const card = within(screen.getByTestId('object-card-101:0'));
    expect(card.getByRole('radio', { name: /This is smoke/i })).not.toBeChecked();
    expect(card.getByRole('radio', { name: /false positive/i })).not.toBeChecked();
    expect(card.getByText('Pending')).toBeInTheDocument();
    expect(card.queryByText('Reviewed')).not.toBeInTheDocument();

    // Even after answering missed smoke, submit stays disabled — the
    // placeholder track alone doesn't count as classified.
    fireEvent.click(screen.getByText('Mock: No missed smoke'));
    expect(screen.getByRole('button', { name: /Submit alert/i })).toBeDisabled();
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
    expect(card.getByRole('radio', { name: /This is smoke/i })).toBeChecked();
    expect(card.getAllByText(/Wildfire/).length).toBeGreaterThan(0);
    expect(card.getByText('Reviewed')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Mock: No missed smoke'));
    expect(screen.getByRole('button', { name: /Submit alert/i })).not.toBeDisabled();
  });

  it('submits with per-lane stages: FP-only lane annotated, smoke lane seq_annotation_done, primary carries has_missed_smoke', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: /This is smoke/i }));
    fireEvent.click(cardA.getByRole('radio', { name: /Wildfire/i }));

    const cardB = within(screen.getByTestId('object-card-102:0'));
    fireEvent.click(cardB.getByRole('radio', { name: /false positive/i }));
    fireEvent.click(cardB.getByRole('checkbox', { name: /Antenna/i }));

    fireEvent.click(screen.getByText('Mock: Missed smoke'));

    const submitButton = screen.getByRole('button', { name: /Submit alert/i });
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
    // Zero editable cards: `isComplete` (`.every()` over an empty list) is
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

    expect(screen.getByRole('button', { name: /Submit alert/i })).toBeDisabled();
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

    const cardB = within(screen.getByTestId('object-card-102:0'));
    fireEvent.click(cardB.getByRole('radio', { name: /false positive/i }));
    fireEvent.click(cardB.getByRole('checkbox', { name: /Antenna/i }));

    fireEvent.click(screen.getByText('Mock: Missed smoke'));

    const submitButton = screen.getByRole('button', { name: /Submit alert/i });
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

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: /This is smoke/i }));
    fireEvent.click(cardA.getByRole('radio', { name: /Wildfire/i }));

    const cardB = within(screen.getByTestId('object-card-102:0'));
    fireEvent.click(cardB.getByRole('radio', { name: /false positive/i }));
    fireEvent.click(cardB.getByRole('checkbox', { name: /Antenna/i }));

    fireEvent.click(screen.getByText('Mock: No missed smoke'));
    fireEvent.click(screen.getByRole('button', { name: /Submit alert/i }));

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

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: /This is smoke/i }));
    fireEvent.click(cardA.getByRole('radio', { name: /Wildfire/i }));

    const cardB = within(screen.getByTestId('object-card-102:0'));
    fireEvent.click(cardB.getByRole('radio', { name: /false positive/i }));
    fireEvent.click(cardB.getByRole('checkbox', { name: /Antenna/i }));

    fireEvent.click(screen.getByText('Mock: No missed smoke'));
    fireEvent.click(screen.getByRole('button', { name: /Submit alert/i }));

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

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: /This is smoke/i }));
    fireEvent.click(cardA.getByRole('radio', { name: /Wildfire/i }));

    const cardB = within(screen.getByTestId('object-card-102:0'));
    fireEvent.click(cardB.getByRole('radio', { name: /false positive/i }));
    fireEvent.click(cardB.getByRole('checkbox', { name: /Antenna/i }));

    fireEvent.click(screen.getByText('Mock: No missed smoke'));
    fireEvent.click(screen.getByRole('button', { name: /Submit alert/i }));

    await waitFor(() => expect(screen.getByText(/Group propagation skipped/)).toBeInTheDocument());

    // The submitted lanes are still on screen (no auto-advance on the
    // warning path) — the page must refetch alert-detail so they redraw
    // locked/read-only instead of staying editable with stale state.
    await waitFor(() => expect(apiClient.getAlertDetail).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        within(screen.getByTestId('object-card-101:0')).getByRole('radio', {
          name: /This is smoke/i,
        })
      ).toBeDisabled()
    );
    expect(
      within(screen.getByTestId('object-card-102:0')).getByRole('radio', {
        name: /false positive/i,
      })
    ).toBeDisabled();
  });

  it('gives every object a distinct color, matching between its card swatch and the shared player overlay', async () => {
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

    // Every object gets its own color, matching card swatch <-> palette index.
    expect(screen.getByTestId('object-color-swatch-101:0')).toHaveStyle({
      backgroundColor: getObjectColor(0),
    });
    expect(screen.getByTestId('object-color-swatch-102:0')).toHaveStyle({
      backgroundColor: getObjectColor(1),
    });
    expect(screen.getByTestId('object-color-swatch-103:0')).toHaveStyle({
      backgroundColor: getObjectColor(2),
    });

    // `objectOverlaysSpy` is called on every render of the (mocked)
    // MissedSmokePanel, including earlier ones where the three lanes'
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
    // Colors match the card swatches for the same object, in the same order.
    expect(lastOverlays[0].color).toBe(getObjectColor(0));
    expect(lastOverlays[1].color).toBe(getObjectColor(1));
    expect(lastOverlays[2].color).toBe(getObjectColor(2));
    // Object 1 and 2 share frame t1; object 3 only has t2.
    expect(lastOverlays[0].boxesByRecordedAt).toHaveProperty('2026-01-01T10:00:00Z');
    expect(lastOverlays[1].boxesByRecordedAt).toHaveProperty('2026-01-01T10:00:00Z');
    expect(lastOverlays[2].boxesByRecordedAt).toHaveProperty('2026-01-01T10:00:05Z');
    expect(lastOverlays[2].boxesByRecordedAt).not.toHaveProperty('2026-01-01T10:00:00Z');
  });

  it('presence strip fills a frame where the lane has a detection but the object has no track bbox on it', async () => {
    // Lane A (101) is captured on two frames (t1, t2), but its track's
    // annotation bbox only references detection_id 1 (t1) — detection_id 4
    // at t2 has no corresponding bbox. The lane still *has a detection* at
    // t2, so the presence strip (unlike the track-box overlay) must render
    // that frame filled, not a gap.
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

    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    // Frame union across all 3 objects sorts to [t1, t2] -> segment index 0
    // = t1, index 1 = t2. Object 1 (index 0) has no bbox at t2, but its
    // lane does have a detection there, so it must render filled.
    await waitFor(() =>
      expect(screen.getByTestId('presence-segment-0-1')).toHaveStyle({
        backgroundColor: getObjectColor(0),
      })
    );
  });

  it('renders the presence strip as the first thing under the header, above the cards grid and the shared player', async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    const strip = screen.getByTestId('object-presence-swatch-0');
    const card = screen.getByTestId('object-card-101:0');
    const player = screen.getByText('Mock: No missed smoke');

    // DOCUMENT_POSITION_FOLLOWING: the compared node comes *after* `strip`
    // in document order.
    expect(strip.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.compareDocumentPosition(player) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("clicking a presence-strip row scrolls to and activates that object's card", async () => {
    await renderAndSettle(<ClassifyAlertPage />, { wrapper });

    // Lane B (sequence 102) is "Object 2" — see makeAlertDetail's laneB.
    fireEvent.click(screen.getByRole('button', { name: 'Go to Object 2' }));

    // The page owns turning the strip's click into "activate that card":
    // Object 2's card shows the same "Active" pill a direct card click
    // would produce, and no other card does.
    await waitFor(() =>
      expect(
        within(screen.getByTestId('object-card-102:0')).getByText('Active')
      ).toBeInTheDocument()
    );
    expect(
      within(screen.getByTestId('object-card-101:0')).queryByText('Active')
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('object-card-103:0')).queryByText('Active')
    ).not.toBeInTheDocument();

    // And it scrolled the card into view — the handler defers the actual
    // scroll a frame (requestAnimationFrame), so wait for it (jsdom stub —
    // see beforeEach).
    await waitFor(() =>
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
      })
    );
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

  it('renders lanes with existing annotations as editable and pre-filled "Reviewed", regardless of processing stage', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const cardA = within(screen.getByTestId('object-card-101:0')); // seq_annotation_done
    expect(cardA.getByText('Reviewed')).toBeInTheDocument();
    expect(cardA.getByRole('radio', { name: /This is smoke/i })).not.toBeDisabled();
    expect(cardA.getByRole('radio', { name: /This is smoke/i })).toBeChecked();

    const cardB = within(screen.getByTestId('object-card-102:0')); // annotated
    expect(cardB.getByText('Reviewed')).toBeInTheDocument();
    expect(cardB.getByRole('radio', { name: /false positive/i })).not.toBeDisabled();
    expect(cardB.getByRole('radio', { name: /false positive/i })).toBeChecked();

    // The annotation-less lane still renders the read-only placeholder —
    // done mode only changes the meaning of "has an annotation", not the
    // "not imported yet" case.
    expect(screen.getByTestId('object-card-placeholder-103')).toBeInTheDocument();
    expect(screen.getByText('Not imported yet')).toBeInTheDocument();
  });

  it('keeps submit disabled until a lane actually changes, even though every card is already validly classified', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const submitButton = screen.getByRole('button', { name: /Submit alert/i });
    expect(submitButton).toBeDisabled();

    // Change lane A's smoke type — a real edit.
    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: /Industrial/i }));

    expect(submitButton).not.toBeDisabled();
  });

  it('PATCHes only the changed lane via updateSequenceAnnotation, leaving the untouched lane alone', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const cardA = within(screen.getByTestId('object-card-101:0'));
    fireEvent.click(cardA.getByRole('radio', { name: /Industrial/i }));

    const submitButton = screen.getByRole('button', { name: /Submit alert/i });
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

  it('an alert-level missed-smoke-only change makes the primary lane "changed" and is saved on its PATCH', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(101) });

    const submitButton = screen.getByRole('button', { name: /Submit alert/i });
    expect(submitButton).toBeDisabled();

    // No card edits at all — only the alert-level missed-smoke review changes.
    fireEvent.click(screen.getByText('Mock: Missed smoke'));
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

  it('scroll-activates the clicked object on load', async () => {
    await renderAndSettle(<ClassifyAlertPage mode="done" />, { wrapper: makeDoneWrapper(102) });

    await waitFor(() =>
      expect(
        within(screen.getByTestId('object-card-102:0')).getByText('Active')
      ).toBeInTheDocument()
    );
    expect(
      within(screen.getByTestId('object-card-101:0')).queryByText('Active')
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
    fireEvent.click(cardA.getByRole('radio', { name: /Industrial/i }));

    const cardB = within(screen.getByTestId('object-card-102:0'));
    fireEvent.click(cardB.getByRole('checkbox', { name: /Building/i }));

    const cardD = within(screen.getByTestId('object-card-104:0'));
    fireEvent.click(cardD.getByRole('radio', { name: /Wildfire/i }));

    const submitButton = screen.getByRole('button', { name: /Submit alert/i });
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
});
