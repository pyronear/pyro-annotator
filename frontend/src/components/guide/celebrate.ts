import confetti from 'canvas-confetti';

/** Fire-lookout palette: ember, pine, char and the line neutral. */
const COLORS = ['#D9581E', '#166A5D', '#20261F', '#E4E2DC', '#FBEFE8'];

/**
 * A short confetti burst from `origin` (an element, usually the button that
 * was just clicked), or from the bottom centre of the screen without one.
 * Skipped for users who prefer reduced motion.
 */
export function celebrate(origin?: Element | null) {
  let x = 0.5;
  let y = 0.8;
  if (origin) {
    const rect = origin.getBoundingClientRect();
    x = (rect.left + rect.width / 2) / window.innerWidth;
    y = (rect.top + rect.height / 2) / window.innerHeight;
  }
  const base = { origin: { x, y }, colors: COLORS, disableForReducedMotion: true, zIndex: 60 };
  void confetti({ ...base, particleCount: 90, spread: 70, startVelocity: 45 });
  void confetti({ ...base, particleCount: 50, spread: 120, startVelocity: 30, scalar: 0.8 });
}
