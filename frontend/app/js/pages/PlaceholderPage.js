import { h } from '../utils/dom.js';
import { EmptyState } from '../components/EmptyState.js';
import { Button } from '../components/Button.js';
import { t } from '../i18n/strings.en.js';
import { navigate } from '../router.js';
import { getState } from '../store.js';

export function PlaceholderPage({ title = 'Coming soon' }) {
  const user = getState().user || {};
  const homePath = user.role === 'customer' ? '/app/find' : '/app/home';

  const homeBtn = Button({
    label: t('app.goHome'),
    variant: 'primary',
    onClick: () => navigate(homePath)
  });

  return h('div', { className: 'placeholder-wrapper' },
    EmptyState({
      title,
      message: t('placeholder.notice'),
      actionButton: homeBtn
    })
  );
}
