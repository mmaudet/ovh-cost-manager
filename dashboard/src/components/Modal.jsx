import { useEffect, useId, useRef } from 'react';

// What the keyboard reaches with Tab, as browsers do: the links, the form controls but those
// disabled, and the elements that a tabindex of 0 or more puts in the order of the page
const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';

/**
 * The controls of an element that Tab reaches, in the order of the page, which no positive
 * tabindex changes in the modals.
 * @param {HTMLElement} element
 * @returns {HTMLElement[]}
 */
const controlsOf = (element) => [...element.querySelectorAll(FOCUSABLE)]
  .filter((control) => control.tabIndex >= 0 && !control.disabled);

/**
 * Generic overlay dialog.
 *
 * Closes on Escape, on a backdrop click and on the header button. The body
 * scrolls on its own so long tables stay inside the viewport.
 *
 * It takes the keyboard focus as the WAI-ARIA dialog pattern describes (#236): onto its first
 * control when it opens, and back to the button that opened it when it closes.
 *
 * A screen reader names the dialog by its title, as the WAI-ARIA dialog pattern describes
 * (#236): the dialog points at the title's element, whatever the title holds, a string or nodes,
 * such as the count and the cost of the resources it lists. And it names the close button,
 * which shows a cross, in the page's language: « Fermer » in French, "Close" in English. The
 * language reaches the modal as it reaches the other components, with the `t` of the shell
 * (ADR 0001), which the tab modules that render the modals pass on, rather than through
 * useLanguage(), which only the shell calls.
 *
 * @param {boolean} open      render nothing when false
 * @param {Function} onClose  called on Escape / backdrop / close button
 * @param {ReactNode} title   header content (string or nodes), which names the dialog
 * @param {ReactNode} actions extra header controls, left of the close button
 * @param {string} maxWidth   Tailwind max-width class for the panel
 * @param {function(string): string} t  the page's translations, which name the close button
 */
export default function Modal({
  open, onClose, title, actions, maxWidth = 'max-w-4xl', t, children,
}) {
  // The id of the title's element, which names the dialog
  const titleId = useId();
  // The dialog, which holds its controls
  const dialog = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  // The keyboard focus (#236). When the dialog opens, it moves onto its first control, its close
  // button at least, so that the next Tab goes on in the dialog rather than in the page behind
  // it. When the dialog closes, it goes back to what had it, the button that opened the dialog,
  // whatever closes it: Escape, the close button or a click on the backdrop. On these two
  // changes only: onClose changes whenever the shell renders the modals, as when the user sorts
  // the table of one, which would send the focus back and forth.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement;
    controlsOf(dialog.current)[0].focus();
    return () => opener?.focus();
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`w-full ${maxWidth} max-h-[85vh] flex flex-col bg-white rounded-lg shadow-xl`}
        onClick={(e) => e.stopPropagation()}
        ref={dialog}
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
            aria-label={t('close')}
          >
            ×
          </button>
        </div>
        <div className="overflow-auto p-4">{children}</div>
      </div>
    </div>
  );
}
