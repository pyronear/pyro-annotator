/**
 * Keyboard shortcuts help for the classify cockpit. Static copy — the
 * actual bindings live in utils/annotation/keyboardUtils (global keys) and
 * ClassifyAlertPage's Tab focus cycle; keep this list in sync with them.
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

export interface ClassifyShortcutsModalProps {
  onClose: () => void;
}

export const ClassifyShortcutsModal: React.FC<ClassifyShortcutsModalProps> = ({ onClose }) => (
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
          <Row label="Cycle objects → missed smoke → submit" keys={['Tab', 'Shift + Tab']} />
        </Section>
        <Section title="Classify the active object">
          <Row label="Smoke / false positive" keys={['S', 'F']} />
          <Row label="Smoke type — wildfire / industrial / other" keys={['1', '2', '3']} />
          <Row label="False-positive type — letter shown on each chip" keys={['A', '…']} />
          <Row label="Toggle unsure" keys={['U']} />
        </Section>
        <Section title="Missed smoke">
          <Row label="Yes / no" keys={['Y', 'N']} />
        </Section>
        <Section title="Alert">
          <Row label="Submit" keys={['Enter']} />
          <Row label="Reset to last saved state" keys={['Ctrl + Z']} />
          <Row label="Toggle this help" keys={['?']} />
        </Section>
      </div>
    </div>
  </div>
);
