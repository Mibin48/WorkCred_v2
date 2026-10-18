import { h } from '../utils/dom.js';
import { t } from '../i18n/strings.en.js';

export function NetworkBanner() {
  const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

  const banner = h('div', {
    className: 'network-banner',
    role: 'status',
    'aria-live': 'polite',
    hidden: isOnline
  }, t('app.offline'));

  if (typeof window !== 'undefined') {
    window.addEventListener('offline', () => {
      banner.textContent = t('app.offline');
      banner.removeAttribute('hidden');
    });

    window.addEventListener('online', () => {
      banner.textContent = t('app.online');
      setTimeout(() => {
        banner.setAttribute('hidden', '');
      }, 3000);
    });
  }

  return banner;
}
