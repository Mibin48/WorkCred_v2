import { h } from '../utils/dom.js';
import { Button } from '../components/Button.js';
import { LedgerRule } from '../components/LedgerRule.js';
import { t } from '../i18n/strings.en.js';
import { navigate } from '../router.js';
import { getState } from '../store.js';

export function CustomerFindPage() {
  const user = getState().user || {};
  const container = h('div', { className: 'card card-surface' });

  const titleEl = h('h1', { className: 'heading-display mb-3' }, `Welcome, ${user.name || 'Customer'}!`);
  const messageEl = h('p', { className: 'body-text mb-4' },
    t('placeholder.customerFindMessage', { name: user.name || 'Customer' })
  );

  const accountLinkBtn = Button({
    label: t('placeholder.accountLink'),
    variant: 'secondary',
    fullWidth: true,
    onClick: () => navigate('/app/account')
  });

  container.appendChild(titleEl);
  container.appendChild(LedgerRule());
  container.appendChild(messageEl);
  container.appendChild(accountLinkBtn);

  return container;
}
