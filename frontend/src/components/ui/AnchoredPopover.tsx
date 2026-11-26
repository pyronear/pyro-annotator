import {
  ReactNode,
  RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { clsx } from 'clsx';

const GAP_PX = 8;
const VIEWPORT_MARGIN_PX = 8;

interface AnchoredPopoverProps {
  /** The element the popover hangs from; clicks on it do not count as outside. */
  anchorRef: RefObject<HTMLElement>;
  onClose: () => void;
  /** Accessible name of the dialog. */
  label: string;
  /** Align the popover's left edge (`start`) or right edge (`end`) with the anchor. */
  align?: 'start' | 'end';
  className?: string;
  children: ReactNode;
}

/**
 * A popover rendered in a portal with fixed positioning, so a scrolling or
 * `overflow-hidden` ancestor (a table container) never clips it. It opens
 * below the anchor, flips above when the viewport has no room below, stays
 * inside the viewport horizontally, and follows the anchor on scroll and
 * resize. Closes on Escape and on a press outside both popover and anchor.
 */
export default function AnchoredPopover({
  anchorRef,
  onClose,
  label,
  align = 'start',
  className,
  children,
}: AnchoredPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const popover = popoverRef.current;
    if (!anchor || !popover) return;
    const rect = anchor.getBoundingClientRect();
    const { offsetWidth: width, offsetHeight: height } = popover;

    const below = rect.bottom + GAP_PX;
    const above = rect.top - GAP_PX - height;
    const fitsBelow = below + height <= window.innerHeight - VIEWPORT_MARGIN_PX;
    const top = fitsBelow || above < VIEWPORT_MARGIN_PX ? below : above;

    const preferredLeft = align === 'start' ? rect.left : rect.right - width;
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN_PX;
    const left = Math.max(VIEWPORT_MARGIN_PX, Math.min(preferredLeft, maxLeft));

    setPosition({ top, left });
  }, [anchorRef, align]);

  useLayoutEffect(place, [place]);

  useEffect(() => {
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    // The content height changes as a search narrows the list.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    if (popoverRef.current) observer?.observe(popoverRef.current);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer?.disconnect();
    };
  }, [place]);

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
      anchorRef.current?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={label}
      style={{
        position: 'fixed',
        top: position?.top ?? 0,
        left: position?.left ?? 0,
        visibility: position ? 'visible' : 'hidden',
      }}
      className={clsx(
        'z-50 overflow-hidden rounded-card border border-line bg-paper shadow-[0_8px_24px_rgba(32,38,31,0.12)]',
        className
      )}
    >
      {children}
    </div>,
    document.body
  );
}
