import { h } from '../utils/dom.js';

export function EmptyState({
  title,
  message,
  actionButton = null
}) {
  const children = [
    h('h2', { className: 'heading-display text-center' }, title),
    h('div', { className: 'ledger-rule' }),
    h('p', { className: 'body-text text-center' }, message)
  ];

  if (actionButton) {
    children.push(h('div', { className: 'btn-group' }, actionButton));
  }

  return h('div', { className: 'card card-surface text-center' }, ...children);
}
