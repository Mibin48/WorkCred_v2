import { h } from '../utils/dom.js';
import { t } from '../i18n/strings.en.js';

export function BottomNav({
  role = 'worker',
  activeTab = 'home',
  counts = {},
  onNavigate
}) {
  const workerTabs = [
    { id: 'home', labelKey: 'nav.home', icon: '/assets/icons/home.svg', path: '/app/home' },
    { id: 'my-work', labelKey: 'nav.myWork', icon: '/assets/icons/mywork.svg', path: '/app/my-work', countKey: 'myWork' },
    { id: 'passport', labelKey: 'nav.passport', icon: '/assets/icons/passport.svg', path: '/app/passport' },
    { id: 'post', labelKey: 'nav.post', icon: '/assets/icons/post.svg', path: '/app/post' },
    { id: 'me', labelKey: 'nav.me', icon: '/assets/icons/me.svg', path: '/app/account' }
  ];

  const customerTabs = [
    { id: 'find', labelKey: 'nav.find', icon: '/assets/icons/find.svg', path: '/app/find' },
    { id: 'free-now', labelKey: 'nav.freeNow', icon: '/assets/icons/freenow.svg', path: '/app/free-now' },
    { id: 'post-job', labelKey: 'nav.postJob', icon: '/assets/icons/postjob.svg', path: '/app/post-job' },
    { id: 'bookings', labelKey: 'nav.bookings', icon: '/assets/icons/bookings.svg', path: '/app/bookings', countKey: 'bookings' },
    { id: 'saved', labelKey: 'nav.saved', icon: '/assets/icons/saved.svg', path: '/app/saved' }
  ];

  const tabs = role === 'customer' ? customerTabs : workerTabs;

  const pill = h('nav', {
    className: 'bottom-nav-pill',
    'aria-label': 'Main application navigation'
  });

  tabs.forEach(tab => {
    const isCurrent = (tab.id === activeTab);
    const countVal = tab.countKey ? counts[tab.countKey] : 0;
    const rawLabel = t(tab.labelKey);
    const displayLabel = (countVal && countVal > 0) ? `${rawLabel} (${countVal})` : rawLabel;

    const navItem = h('a', {
      href: tab.path,
      className: 'bottom-nav-item',
      'aria-current': isCurrent ? 'page' : undefined,
      onClick: (e) => {
        e.preventDefault();
        if (onNavigate) onNavigate(tab.path, tab.id);
      }
    },
      h('img', {
        src: tab.icon,
        alt: '',
        className: 'bottom-nav-icon',
        width: '20',
        height: '20'
      }),
      h('span', { className: 'bottom-nav-label' }, displayLabel)
    );

    pill.appendChild(navItem);
  });

  return h('div', { className: 'bottom-nav-container' }, pill);
}
