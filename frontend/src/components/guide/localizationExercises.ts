import type { NormalizedBox } from '@/utils/annotation/boxOverlap';

/**
 * The localization training set: five wildfire frames whose box is known.
 *
 * Taken from the pinned sample dataset (`.sample-data/sample-data-v1`, see
 * annotation_api/docs/sample-data.md): each is one frame of a single-object
 * `done` wildfire alert, and `reference` is that frame's exported box. The
 * images are copied into frontend/public/guide/localization/ so the exercise
 * needs no API and no seeded database. Ordered from the plainest plume to the
 * faintest.
 */
export interface LocalizationExercise {
  src: string;
  reference: NormalizedBox;
  /** Shown once the answer is revealed, never before: it would give it away. */
  note: string;
}

export const PASS_MARK = 4;

export const LOCALIZATION_EXERCISES: LocalizationExercise[] = [
  {
    // api_cenia alert 1005, detection 471
    src: '/guide/localization/exercise-1.jpg',
    reference: [0.3146793246269226, 0.2876042127609253, 0.42740410566329956, 0.40737301111221313],
    note: 'A dense plume: the box runs from its base on the treeline to the top of the cloud, drifting part included.',
  },
  {
    // pyronear_french alert 1039, detection 1040
    src: '/guide/localization/exercise-2.jpg',
    reference: [0.38320380449295044, 0.5543582439422607, 0.48806291818618774, 0.6090055108070374],
    note: 'Smoke spreading flat over the rooftops: a wide, low box, not a tall one.',
  },
  {
    // pyronear_french alert 1050, detection 1340
    src: '/guide/localization/exercise-3.jpg',
    reference: [0.066015625, 0.3597222222222222, 0.123046875, 0.44722222222222224],
    note: 'Pale smoke against haze: follow the plume from where it leaves the slope to where it fades.',
  },
  {
    // api_cenia alert 1017, detection 824
    src: '/guide/localization/exercise-4.jpg',
    reference: [0.7820781469345093, 0.2595326006412506, 0.8873239755630493, 0.41176170110702515],
    note: 'The plume leans with the wind: the box covers the whole lean, down to the base on the horizon.',
  },
  {
    // api_cenia alert 1033, detection 1969
    src: '/guide/localization/exercise-5.jpg',
    reference: [0.7750582873885885, 0.34279633755526695, 0.8331626829929841, 0.5156901104490398],
    note: 'A thin column far away: zoom in, and keep the box narrow and tall around it.',
  },
];
