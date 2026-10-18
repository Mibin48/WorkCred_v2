import { h } from '../utils/dom.js';
import { api } from '../api.js';
import { t } from '../i18n/strings.en.js';

export function DevBanner({ onFillCredentials }) {
  const container = h('div', { className: 'dev-banner-wrapper' });

  // Guard: hide if not localhost or 127.0.0.1
  if (typeof window !== 'undefined' && window.location) {
    const host = window.location.hostname;
    if (host !== 'localhost' && host !== '127.0.0.1') {
      return container;
    }
  }

  // Request GET /demo/accounts
  api.getDemoAccounts().then(res => {
    const data = res?.data || res;
    if (!data || !data.accounts || data.accounts.length === 0) return;

    const demoPassword = data.demoPassword || 'workcred_demo_pass_2026';
    const accounts = data.accounts;

    const details = h('details', { className: 'dev-banner' },
      h('summary', null, t('dev.bannerTitle')),
      h('div', { className: 'dev-accounts-list' })
    );

    const listEl = details.querySelector('.dev-accounts-list');

    // Add note with password fill button
    const passRow = h('div', { className: 'dev-account-row' },
      h('div', null,
        h('strong', null, t('dev.samplePasswordNote')),
        h('div', { className: 'font-mono' }, demoPassword)
      ),
      h('button', {
        type: 'button',
        className: 'btn btn-quiet',
        onClick: () => {
          if (onFillCredentials) onFillCredentials({ password: demoPassword });
        }
      }, t('dev.fillInPassword'))
    );
    listEl.appendChild(passRow);

    accounts.forEach(acc => {
      const row = h('div', { className: 'dev-account-row' },
        h('div', null,
          h('div', { className: 'font-bold' }, `${acc.name} (${acc.role})`),
          h('div', { className: 'text-small' }, acc.email)
        ),
        h('button', {
          type: 'button',
          className: 'btn btn-secondary',
          onClick: () => {
            if (onFillCredentials) {
              onFillCredentials({
                email: acc.email,
                password: demoPassword,
                role: acc.role
              });
            }
          }
        }, t('dev.fillBoth'))
      );
      listEl.appendChild(row);
    });

    container.appendChild(details);
  }).catch(() => {
    // On 404 or error, render nothing
  });

  return container;
}
