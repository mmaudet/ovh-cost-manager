import { useEffect, useId, useRef } from 'react';

// What may be a control that Tab reaches in a dialog (#236): the links, the form controls and the
// elements with a tabindex, disabled ones and those that a tabindex of -1 keeps out of the order
// of the page included, which controlsOf() leaves out
const TABBABLE_CANDIDATES =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex]';

/**
 * The controls of an element that Tab reaches, as browsers do, in the order of the page, which
 * no positive tabindex changes in the modals.
 * @param {HTMLElement} element
 * @returns {HTMLElement[]}
 */
const controlsOf = (element) => [...element.querySelectorAll(TABBABLE_CANDIDATES)]
  .filter((control) => control.tabIndex >= 0 && !control.disabled);

/**
 * Keeps the keyboard focus within a dialog (#236): Tab from its last control goes round to its
 * first, and Shift+Tab from its first to its last, rather than on to the page behind it. So
 * does either key once the focus is off its controls, as after a click on its table, which
 * gives the focus to the page.
 * @param {KeyboardEvent} event - A press of Tab, with Shift or not
 * @param {HTMLElement} dialog
 */
const keepFocusIn = (event, dialog) => {
  const controls = controlsOf(dialog);
  const [first, last] = [controls[0], controls[controls.length - 1]];
  // The control from which the key would leave the dialog, and the one it goes round to instead
  const [edge, wrapTo] = event.shiftKey ? [first, last] : [last, first];
  const focused = document.activeElement;
  if (focused === edge || !controls.includes(focused)) {
    event.preventDefault();
    wrapTo.focus();
  }
};

/**
 * Generic overlay dialog.
 *
 * Closes on Escape, on a backdrop click and on the header button. The body
 * scrolls on its own so long tables stay inside the viewport.
 *
 * It takes the keyboard focus as the WAI-ARIA dialog pattern describes (#236): onto its first
 * control when it opens, within it while it is open, where Tab and Shift+Tab go round its
 * controls, and back to the button that opened it when it closes.
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

  // Escape closes the dialog, and Tab keeps the focus within it (#236)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'Tab') keepFocusIn(e, dialog.current);
    };
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
