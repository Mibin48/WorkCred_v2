import { h } from '../utils/dom.js';
import { Wordmark } from '../components/Wordmark.js';
import { NetworkBanner } from '../components/NetworkBanner.js';

export function PublicLayout({ contentNode }) {
  return h('div', { className: 'app-viewport' },
    h('div', { className: 'app-frame' },
      NetworkBanner(),
      h('div', { className: 'public-header text-center p-4' },
        Wordmark({ href: '/' })
      ),
      h('main', { className: 'public-container' }, contentNode)
    )
  );
}
