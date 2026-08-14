/**
 * Keyboard shortcuts help for the localize object editor, opened from the
 * Keyboard button in its top bar or with `?`.
 *
 * Static copy — the bindings live in `LocalizeObjectEditor`'s key handler;
 * keep this list in sync with it.
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

export interface EditorShortcutsModalProps {
  onClose: () => void;
}

export const EditorShortcutsModal: React.FC<EditorShortcutsModalProps> = ({ onClose }) => (
  <div
    className="fixed inset-0 bg-char/50 flex items-center justify-center z-50"
    onClick={onClose}
    data-testid="editor-shortcuts-modal"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="bg-paper border border-line rounded-card w-full max-w-md max-h-[90vh] overflow-y-auto m-4"
      onClick={e => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-6 py-4 border-b border-line">
        <h2 className="font-display text-heading font-semibold text-char">Keyboard shortcuts</h2>
        <button
          onClick={onClose}
          aria-label="Close"
          data-testid="editor-shortcuts-close"
          className="p-2 hover:bg-ash rounded-md"
        >
          <X className="w-5 h-5 text-haze" />
        </button>
      </div>
      <div className="px-6 py-5 space-y-5">
        <Section title="Move through the object">
          <Row label="Previous / next frame" keys={['←', '→']} />
          <Row label="Accept this frame's box and move on" keys={['Enter']} />
        </Section>
        <Section title="The box on this frame">
          <Row label="Draw one — drag on the image" keys={['drag']} />
          <Row label="Move or resize — click it first, then drag" keys={['click']} />
          <Row label="Mark the object not visible here" keys={['Del']} />
          <Row label="Copy the previous frame's box here" keys={['P']} />
          <Row label="Deselect the box" keys={['Esc']} />
        </Section>
        <Section title="Move around the image">
          <Row label="Pan" keys={['Space + drag']} />
          <Row label="Pan without the keyboard" keys={['middle-drag']} />
          <Row label="Zoom at the pointer" keys={['wheel']} />
          <Row label="Zoom to the object" keys={['Z']} />
          <Row label="Reset the zoom" keys={['R']} />
        </Section>
        <Section title="What you can see">
          <Row label="Cycle boxes — default, all sources, none" keys={['G']} />
          <Row label="Boxes from the alert's other objects" keys={['O']} />
        </Section>
        <Section title="Leave">
          <Row label="Close the editor" keys={['Esc']} />
          <Row label="Toggle this help" keys={['?']} />
        </Section>
      </div>
    </div>
  </div>
);
