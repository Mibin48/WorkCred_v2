import { h } from '../utils/dom.js';

export function Sheet({
  id = 'sheet-dialog',
  title = '',
  contentNode,
  hasInput = false,
  onClose
}) {
  let previousActiveElement = null;

  const closeBtn = h('button', {
    type: 'button',
    className: 'btn btn-quiet',
    'aria-label': 'Close dialog',
    onClick: () => closeSheet()
  },
    h('svg', {
      width: '18',
      height: '18',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    },
      h('line', { x1: '18', y1: '6', x2: '6', y2: '18' }),
      h('line', { x1: '6', y1: '6', x2: '18', y2: '18' })
    )
  );

  const headerEl = h('div', { className: 'sheet-header' },
    h('h2', { className: 'sheet-title' }, title),
    closeBtn
  );

  const bodyEl = h('div', { className: 'sheet-content' }, contentNode);

  const dialog = h('dialog', {
    id,
    className: 'sheet-dialog',
    onClick: (e) => {
      // Backdrop click detection
      const rect = dialog.getBoundingClientRect();
      const isOutside = (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
      );
      if (isOutside && !hasInput) {
        closeSheet();
      }
    },
    onKeydown: (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSheet();
      } else if (e.key === 'Tab') {
        // Focus trap
        const focusable = dialog.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
  }, headerEl, bodyEl);

  function openSheet() {
    previousActiveElement = document.activeElement;
    if (!document.body.contains(dialog)) {
      document.body.appendChild(dialog);
    }
    dialog.showModal();
    // Focus first element or close button
    closeBtn.focus();
  }

  function closeSheet() {
    if (dialog.open) {
      dialog.close();
    }
    if (dialog.parentNode) {
      dialog.parentNode.removeChild(dialog);
    }
    if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
    }
    if (onClose) onClose();
  }

  return {
    element: dialog,
    open: openSheet,
    close: closeSheet
  };
}
