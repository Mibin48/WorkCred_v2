import { h } from '../utils/dom.js';
import { api } from '../api.js';
import { Button } from '../components/Button.js';
import { LedgerRule } from '../components/LedgerRule.js';
import { t } from '../i18n/strings.en.js';
import { navigate } from '../router.js';
import { getState } from '../store.js';

export function AccountPage() {
  const state = getState();
  const user = state.user || {};
  const meta = state.meta || { localities: [] };

  const localityObj = meta.localities?.find(l => l.key === user.localityKey);
  const localityName = localityObj ? localityObj.name : (user.localityKey || 'Not set');

  const container = h('div', { className: 'account-page-card card card-surface' });

  const titleEl = h('h1', { className: 'heading-display mb-3' }, t('account.title'));

  const summarySection = h('div', { className: 'profile-summary' },
    h('h2', { className: 'heading-title-sm mb-3' }, t('account.profileSummary')),
    h('div', { className: 'summary-row' },
      h('span', { className: 'field-label' }, t('auth.nameLabel')),
      h('span', { className: 'body-text' }, user.name || '—')
    ),
    h('div', { className: 'summary-row' },
      h('span', { className: 'field-label' }, t('auth.emailLabel')),
      h('span', { className: 'body-text font-mono' }, user.email || '—')
    ),
    h('div', { className: 'summary-row' },
      h('span', { className: 'field-label' }, t('auth.phoneLabel')),
      h('span', { className: 'body-text font-mono' }, user.phone ? `+91 ${user.phone}` : '—')
    ),
    h('div', { className: 'summary-row' },
      h('span', { className: 'field-label' }, t('account.roleLabel')),
      h('span', { className: 'body-text capitalize' }, user.role || '—')
    ),
    h('div', { className: 'summary-row' },
      h('span', { className: 'field-label' }, t('onboarding.localityLabel')),
      h('span', { className: 'body-text' }, localityName)
    )
  );

  const editProfileBtn = Button({
    label: t('account.editProfile'),
    variant: 'secondary',
    fullWidth: true,
    onClick: () => navigate('/app/onboarding')
  });

  const changePasswordBtn = Button({
    label: t('account.changePassword'),
    variant: 'secondary',
    fullWidth: true,
    onClick: () => navigate('/app/account/password')
  });

  const logoutBtn = Button({
    label: t('auth.logout'),
    variant: 'danger',
    fullWidth: true,
    onClick: async () => {
      logoutBtn.setAttribute('aria-busy', 'true');
      logoutBtn.disabled = true;
      // Initiate logout request without awaiting to avoid UI delay
      api.logout().catch(() => {}); // fire-and-forget, ignore errors
      // Immediately navigate to login page; session will be cleared via broadcast
      navigate('/app/login');
    }
  });

  container.appendChild(titleEl);
  container.appendChild(summarySection);
  container.appendChild(LedgerRule());
  container.appendChild(h('div', { className: 'btn-group' },
    editProfileBtn,
    changePasswordBtn,
    logoutBtn
  ));

  return container;
}
