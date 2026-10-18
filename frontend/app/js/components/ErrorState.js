import { h } from '../utils/dom.js';
import { Button } from './Button.js';

export function ErrorState({
  title = 'Something went wrong',
  message = 'We could not complete this request. Please try again.',
  retryLabel = 'Retry',
  onRetry
}) {
  const retryBtn = onRetry ? Button({
    label: retryLabel,
    variant: 'primary',
    onClick: onRetry
  }) : null;

  return h('div', { className: 'card card-surface text-center', role: 'alert' },
    h('h2', { className: 'heading-display text-center' }, title),
    h('div', { className: 'ledger-rule' }),
    h('p', { className: 'body-text text-center' }, message),
    retryBtn ? h('div', { className: 'btn-group' }, retryBtn) : null
  );
}
