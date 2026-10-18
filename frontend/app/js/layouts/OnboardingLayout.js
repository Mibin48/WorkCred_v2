import { h } from '../utils/dom.js';
import { Wordmark } from '../components/Wordmark.js';
import { NetworkBanner } from '../components/NetworkBanner.js';

export function OnboardingLayout({
  stepText = '',
  contentNode
}) {
  return h('div', { className: 'app-viewport' },
    h('div', { className: 'app-frame' },
      NetworkBanner(),
      h('header', { className: 'app-header' },
        Wordmark({ href: null }),
        stepText ? h('span', { className: 'field-hint font-medium' }, stepText) : null
      ),
      h('main', { className: 'onboarding-container' }, contentNode)
    )
  );
}
