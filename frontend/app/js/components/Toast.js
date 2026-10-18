import { h } from '../utils/dom.js';

let toastContainer = null;

export function ensureToastContainer() {
  if (!toastContainer || !document.body.contains(toastContainer)) {
    toastContainer = h('div', {
      className: 'toast-region',
      'aria-live': 'polite',
      'aria-atomic': 'true'
    });
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

export function showToast(message, type = 'info', durationMs = 4000) {
  const container = ensureToastContainer();

  const toastEl = h('div', {
    className: 'toast',
    'data-type': type,
    role: 'status'
  },
    h('span', null, message)
  );

  container.appendChild(toastEl);

  setTimeout(() => {
    if (toastEl.parentNode) {
      toastEl.parentNode.removeChild(toastEl);
    }
  }, durationMs);
}
