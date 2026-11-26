import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ClassificationExercise from '@/components/guide/ClassificationExercise';
import {
  CLASSIFICATION_EXERCISES,
  isObjectAnswerRight,
  trainingMediaSource,
  type ExpectedClassification,
  type TrainingAlert,
  type TrainingObject,
} from '@/components/guide/classificationExercises';
import { celebrate } from '@/components/guide/celebrate';

vi.mock('@/components/guide/celebrate', () => ({ celebrate: vi.fn() }));

let nextId = 1;
function object(expected: ExpectedClassification): TrainingObject {
  const sequenceId = nextId++;
  return {
    sequenceId,
    expected,
    frames: [0, 1].map(i => ({
      detectionId: sequenceId * 100 + i,
      recordedAt: `2026-07-01T10:00:0${i}Z`,
      src: `/guide/classification/test/${sequenceId}-${i}.jpg`,
      box: [0.1, 0.1, 0.2, 0.2] as [number, number, number, number],
      algoPredictions: null,
      othersBboxes: null,
    })),
  };
}

const WILDFIRE: ExpectedClassification = { kind: 'smoke', smokeType: 'wildfire' };
const BUILDING: ExpectedClassification = {
  kind: 'false_positive',
  falsePositiveTypes: ['building'],
};

function alert(...objects: TrainingObject[]): TrainingAlert {
  return {
    source: `test alert ${nextId}`,
    organisationName: 'org-test',
    cameraName: `cam-${nextId}`,
    recordedAt: '2026-07-01T10:00:00Z',
    objects,
    expectedMissedSmoke: 'no',
    note: `Note ${nextId}`,
  };
}

/** Four one-object wildfire alerts, then a wildfire + building one. */
const makeExercises = () => [
  alert(object(WILDFIRE)),
  alert(object(WILDFIRE)),
  alert(object(WILDFIRE)),
  alert(object(WILDFIRE)),
  alert(object(WILDFIRE), object(BUILDING)),
];

function renderExercise(exercises: TrainingAlert[], onPass = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ClassificationExercise
          exercises={exercises}
          onPass={onPass}
          afterPass={<a href="/classify">Start classifying</a>}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return onPass;
}

const submit = () => screen.getByTestId('training-submit');
const row = (n: number) => screen.getByRole('group', { name: `Object ${n}` });
const chip = (name: string) => screen.getByRole('radio', { name });
const missedSmoke = (answer: 'Yes' | 'No') =>
  within(screen.getByRole('radiogroup', { name: 'Missed smoke review' })).getByRole('radio', {
    name: answer,
  });

function answerWildfire(n = 1) {
  fireEvent.click(row(n));
  fireEvent.click(chip('Smoke'));
  fireEvent.click(chip('Wildfire'));
}

function answerBuilding(n: number) {
  fireEvent.click(row(n));
  fireEvent.click(chip('False positive'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Building' }));
}

function submitAlert({ right }: { right: boolean }) {
  if (right) answerWildfire();
  else {
    fireEvent.click(row(1));
    fireEvent.click(chip('Smoke'));
    fireEvent.click(chip('Industrial'));
  }
  fireEvent.click(missedSmoke('No'));
  fireEvent.click(submit());
  fireEvent.click(screen.getByRole('button', { name: /next alert|see my result/i }));
}

describe('ClassificationExercise', () => {
  it('opens on the first alert in a replica of the classify cockpit', () => {
    const exercises = makeExercises();
    renderExercise(exercises);
    expect(screen.getByText('Alert 1 of 5')).toBeInTheDocument();
    expect(screen.getByText(`org-test · ${exercises[0].cameraName}`)).toBeInTheDocument();
    expect(screen.getByText('0 of 1 objects classified')).toBeInTheDocument();
    expect(screen.getByTestId('classify-media-panel')).toBeInTheDocument();
    expect(screen.getByTestId('missed-smoke-row')).toBeInTheDocument();
  });

  it('only lets the alert be submitted once every object and missed smoke are answered', () => {
    renderExercise(makeExercises());
    expect(submit()).toBeDisabled();
    answerWildfire();
    expect(screen.getByText('1 of 1 objects classified')).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.click(missedSmoke('No'));
    expect(submit()).toBeEnabled();
  });

  it('validates an alert when every choice is right', () => {
    const exercises = makeExercises();
    renderExercise(exercises);
    answerWildfire();
    fireEvent.click(missedSmoke('No'));
    fireEvent.click(submit());

    expect(screen.getByRole('img', { name: 'Alert validated' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Alert validated');
    expect(screen.getByText(exercises[0].note)).toBeInTheDocument();
    expect(screen.getByText('Right — Smoke · Wildfire')).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: 'Alert 1: validated' })).toBeInTheDocument();
  });

  it('shows the expected answer for a wrong object and a wrong missed-smoke answer', () => {
    renderExercise(makeExercises());
    fireEvent.click(row(1));
    fireEvent.click(chip('Smoke'));
    fireEvent.click(chip('Industrial'));
    fireEvent.click(missedSmoke('Yes'));
    fireEvent.click(submit());

    expect(screen.getByRole('img', { name: 'Alert not validated' })).toBeInTheDocument();
    expect(screen.getByText(/You said Smoke · Industrial/)).toHaveTextContent(
      'expected Smoke · Wildfire'
    );
    expect(screen.getByText(/Missed smoke:/)).toHaveTextContent('you said Yes · expected No');
  });

  it('grades a multi-object alert object by object', () => {
    const exercises = makeExercises();
    renderExercise([exercises[4]]);
    answerWildfire(1);
    answerBuilding(2);
    fireEvent.click(missedSmoke('No'));
    fireEvent.click(submit());
    expect(screen.getByRole('img', { name: 'Alert validated' })).toBeInTheDocument();
  });

  it('passes with four validated alerts out of five: confetti and the way to the queue', () => {
    const onPass = renderExercise(makeExercises());
    for (let i = 0; i < 4; i++) submitAlert({ right: true });
    // The fifth (two objects) left wrong.
    answerWildfire(1);
    fireEvent.click(missedSmoke('No'));
    answerWildfire(2);
    fireEvent.click(submit());
    fireEvent.click(screen.getByRole('button', { name: 'See my result' }));

    expect(screen.getByText('alerts validated · 4 needed to pass')).toBeInTheDocument();
    expect(screen.getByText("Passed — you're ready to classify!")).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Start classifying' })).toBeInTheDocument();
    expect(celebrate).toHaveBeenCalled();
    expect(onPass).toHaveBeenCalledTimes(1);
  });

  it('offers a fresh attempt below the pass mark', () => {
    const onPass = renderExercise(makeExercises());
    submitAlert({ right: true });
    submitAlert({ right: true });
    submitAlert({ right: true });
    submitAlert({ right: false });
    // Fifth alert, both objects right but missed smoke wrong.
    answerWildfire(1);
    answerBuilding(2);
    fireEvent.click(missedSmoke('Yes'));
    fireEvent.click(submit());
    fireEvent.click(screen.getByRole('button', { name: 'See my result' }));

    expect(screen.getByText(/you need 4 validated alerts out of 5/)).toBeInTheDocument();
    expect(onPass).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(screen.getByText('Alert 1 of 5')).toBeInTheDocument();
  });

  it('classifies with the keyboard shortcuts of the classify cockpit', () => {
    renderExercise(makeExercises());
    fireEvent.click(row(1));
    fireEvent.keyDown(document, { key: 's' });
    fireEvent.keyDown(document, { key: '1' });
    fireEvent.keyDown(document, { key: 'n' });
    expect(submit()).toBeEnabled();
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(screen.getByRole('img', { name: 'Alert validated' })).toBeInTheDocument();
  });
});

describe('isObjectAnswerRight', () => {
  const answer = {
    classification: 'false_positive' as const,
    unsure: false,
    falsePositiveTypes: ['building' as const],
  };

  it('needs the smoke type for smoke', () => {
    expect(
      isObjectAnswerRight(
        { ...answer, classification: 'smoke', smokeType: 'wildfire', falsePositiveTypes: [] },
        WILDFIRE
      )
    ).toBe(true);
    expect(
      isObjectAnswerRight(
        { ...answer, classification: 'smoke', smokeType: 'other', falsePositiveTypes: [] },
        WILDFIRE
      )
    ).toBe(false);
  });

  it('needs every expected false-positive type, and tolerates an extra one', () => {
    expect(isObjectAnswerRight(answer, BUILDING)).toBe(true);
    expect(
      isObjectAnswerRight({ ...answer, falsePositiveTypes: ['building', 'light'] }, BUILDING)
    ).toBe(true);
    expect(isObjectAnswerRight({ ...answer, falsePositiveTypes: ['light'] }, BUILDING)).toBe(false);
  });

  it('never counts Unsure as right', () => {
    expect(isObjectAnswerRight({ ...answer, unsure: true }, BUILDING)).toBe(false);
  });
});

describe('the training set', () => {
  it('has five alerts with their frames and expected answers', () => {
    expect(CLASSIFICATION_EXERCISES).toHaveLength(5);
    CLASSIFICATION_EXERCISES.forEach(training => {
      expect(training.note).toBeTruthy();
      training.objects.forEach(o => {
        expect(o.frames.length).toBeGreaterThan(0);
        o.frames.forEach(f => expect(f.src).toMatch(/^\/guide\/classification\/alert-\d\//));
      });
    });
  });

  it('serves every frame to the players without the API', async () => {
    const source = trainingMediaSource(CLASSIFICATION_EXERCISES);
    const first = CLASSIFICATION_EXERCISES[0].objects[0];
    await expect(source.getDetectionImageUrl(first.frames[0].detectionId)).resolves.toEqual({
      url: first.frames[0].src,
    });
    const detections = await source.getSequenceDetections(first.sequenceId);
    expect(detections.map(d => d.recorded_at)).toEqual(first.frames.map(f => f.recordedAt));
  });
});
