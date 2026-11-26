import { ROUTES } from '@/utils/routes';

/**
 * The training modules listed on the user guide hub (/guide). The hub card
 * and the module's own page read the same entry, so a title or a time
 * estimate can't drift between the two.
 */
export interface GuideModule {
  /** Short mono eyebrow above the title. */
  eyebrow: string;
  title: string;
  summary: string;
  /** Rough reading/practice time, shown in small mono type. */
  duration: string;
  href: string;
  /** Accent of the eyebrow: ember is Classify, pine is Localize, char is neutral. */
  tone: 'char' | 'ember' | 'pine';
  comingSoon: boolean;
}

export const BASICS_MODULE: GuideModule = {
  eyebrow: 'Basics',
  title: 'How annotation works',
  summary: 'Understand how to turn an alert into training data.',
  duration: '~5 min read',
  href: ROUTES.GUIDE_BASICS,
  tone: 'char',
  comingSoon: false,
};

export const CLASSIFICATION_MODULE: GuideModule = {
  eyebrow: 'Classification',
  title: 'Classification — advanced training',
  summary:
    'Practise on reference alerts: tell wildfire smoke apart from clouds, dust, glare and other smoke.',
  duration: '~1 min video',
  href: ROUTES.GUIDE_CLASSIFICATION,
  tone: 'ember',
  comingSoon: false,
};

export const LOCALIZATION_MODULE: GuideModule = {
  eyebrow: 'Localization',
  title: 'Localization — advanced training',
  summary:
    'Practise drawing tight boxes and handling hard cases: small plumes, night images, missed smoke.',
  duration: '~20 min',
  href: ROUTES.GUIDE_LOCALIZATION,
  tone: 'pine',
  comingSoon: true,
};

export const TONE_TEXT: Record<GuideModule['tone'], string> = {
  char: 'text-char',
  ember: 'text-ember',
  pine: 'text-pine',
};
