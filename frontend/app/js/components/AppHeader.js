import { h } from '../utils/dom.js';

export function AppHeader({
  title = 'WorkCred',
  contextLine = '',
  user = null,
  onAccountClick
}) {
  const titlesContainer = h('div', { className: 'app-header-titles' },
    h('h1', { className: 'app-header-title', tabindex: '-1' }, title)
  );

  if (contextLine) {
    titlesContainer.appendChild(h('div', { className: 'app-header-context' }, contextLine));
  }

  const headerEl = h('header', { className: 'app-header' }, titlesContainer);

  // If customer, show initials button on the right leading to account
  if (user && user.role === 'customer') {
    const initials = (user.name || 'C')
      .split(' ')
      .filter(Boolean)
      .map(part => part[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const initialsBtn = h('button', {
      type: 'button',
      className: 'initials-btn',
      'aria-label': `Account menu for ${user.name || 'Customer'}`,
      onClick: (e) => {
        if (onAccountClick) onAccountClick(e);
      }
    }, initials);

    headerEl.appendChild(initialsBtn);
  }

  return headerEl;
}
