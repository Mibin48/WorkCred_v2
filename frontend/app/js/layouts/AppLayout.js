import { h } from '../utils/dom.js';
import { AppHeader } from '../components/AppHeader.js';
import { BottomNav } from '../components/BottomNav.js';
import { NetworkBanner } from '../components/NetworkBanner.js';

export function AppLayout({
  title,
  contextLine,
  user,
  activeTab,
  counts = {},
  contentNode,
  onNavigate,
  onAccountClick
}) {
  return h('div', { className: 'app-viewport' },
    h('div', { className: 'app-frame' },
      NetworkBanner(),
      AppHeader({
        title,
        contextLine,
        user,
        onAccountClick
      }),
      h('main', { className: 'page-container' }, contentNode),
      BottomNav({
        role: user?.role || 'worker',
        activeTab,
        counts,
        onNavigate
      })
    )
  );
}
