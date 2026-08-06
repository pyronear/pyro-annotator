/**
 * Keyboard shortcuts help for the localize cockpit, opened from the Keyboard
 * button in the Objects rail header or with `?`.
 *
 * Static copy — the bindings live in LocalizeAlertPage's key handlers (the
 * page-level S/M/L/P/? effect, which also answers Enter/Escape for the
 * accept popover, the `c` crop effect, the Tab cycle) and
 * LocalizeObjectRow's Enter/Space activation; keep this list in sync.
 *
 * The Key/Row/Section primitives mirror `ClassifyShortcutsModal`'s so the two
 * help sheets look like one product. They are duplicated rather than shared:
 * extracting them would mean editing the classify sheet, which works and is
 * not what this change is about.
 */

import React from 'react';
import { X } from 'lucide-react';

const Key: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="px-1.5 py-0.5 rounded border border-line bg-ash font-data text-[11px] font-medium text-char">
    {children}
  </kbd>
);

const Row: React.FC<{ label: string; keys: string[] }> = ({ label, keys }) => (
  <div className="flex items-center justify-between gap-4 py-1">
    <span className="font-body text-sm text-char">{label}</span>
    <span className="flex flex-none items-center gap-1">
      {keys.map(k => (
        <Key key={k}>{k}</Key>
      ))}
    </span>
  </div>
);

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <div className="font-data text-eyebrow font-medium uppercase tracking-eyebrow text-haze mb-1.5">
      {title}
    </div>
    {children}
  </div>
);

export interface LocalizeShortcutsModalProps {
  onClose: () => void;
}

export const LocalizeShortcutsModal: React.FC<LocalizeShortcutsModalProps> = ({ onClose }) => (
  <div className="fixed inset-0 bg-char/50 flex items-center justify-center z-50" onClick={onClose}>
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="bg-paper border border-line rounded-card w-full max-w-md max-h-[90vh] overflow-y-auto m-4"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-line">
        <h2 className="font-display text-heading font-semibold text-char">Keyboard shortcuts</h2>
        <button onClick={onClose} aria-label="Close" className="p-2 hover:bg-ash rounded-md">
          <X className="w-5 h-5 text-haze" />
        </button>
      </div>
      <div className="px-6 py-5 space-y-5">
        <Section title="Navigate">
          <Row label="Cycle objects" keys={['Tab', 'Shift + Tab']} />
          <Row label="Open the focused object" keys={['Enter', 'Space']} />
        </Section>
        <Section title="Act">
          <Row label="Accept the model's boxes" keys={['Enter']} />
          <Row label="Reclassify the object" keys={['R']} />
        </Section>
        <Section title="View">
          <Row label="Frame card size" keys={['S', 'M', 'L']} />
          <Row label="Crop cells" keys={['C']} />
          <Row label="Cropped view — loop the object's crops" keys={['P']} />
        </Section>
        <Section title="Help">
          <Row label="Toggle this help" keys={['?']} />
        </Section>
      </div>
    </div>
  </div>
);
