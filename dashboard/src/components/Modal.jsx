import { useEffect, useId } from 'react';

/**
 * Generic overlay dialog.
 *
 * Closes on Escape, on a backdrop click and on the header button. The body
 * scrolls on its own so long tables stay inside the viewport.
 *
 * A screen reader names the dialog by its title, as the WAI-ARIA dialog pattern describes
 * (#236): the dialog points at the title's element, whatever the title holds, a string or nodes,
 * such as the count and the cost of the resources it lists.
 *
 * @param {boolean} open      render nothing when false
 * @param {Function} onClose  called on Escape / backdrop / close button
 * @param {ReactNode} title   header content (string or nodes), which names the dialog
 * @param {ReactNode} actions extra header controls, left of the close button
 * @param {string} maxWidth   Tailwind max-width class for the panel
 */
export default function Modal({ open, onClose, title, actions, maxWidth = 'max-w-4xl', children }) {
  // The id of the title's element, which names the dialog
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} max-h-[85vh] flex flex-col bg-white rounded-lg shadow-xl`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b">
          <div id={titleId} className="flex-1 font-medium text-gray-700">{title}</div>
          {actions}
          <button
            onClick={onClose}
            className="px-2 py-0.5 text-gray-400 hover:text-gray-700 text-xl leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}
