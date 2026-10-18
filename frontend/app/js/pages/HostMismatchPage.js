import { h } from '../utils/dom.js';
import { t } from '../i18n/strings.en.js';

export function HostMismatchPage() {
  const allowedHost = window.location.hostname;

  return h('div', { className: 'card card-surface text-center', role: 'alert' },
    h('h1', { className: 'heading-display mb-3' }, t('app.hostMismatchTitle')),
    h('div', { className: 'ledger-rule' }),
    h('p', { className: 'body-text' }, t('app.hostMismatchMessage', { allowedHost }))
  );
}
