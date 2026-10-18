import { h } from '../utils/dom.js';

export function IndexTabs({
  tabs = [],
  activeId,
  ariaLabel = 'Navigation tabs',
  onSelect
}) {
  const tabElements = [];

  const container = h('div', {
    className: 'index-tabs',
    role: 'tablist',
    'aria-label': ariaLabel,
    onKeydown: (e) => {
      const currentIndex = tabs.findIndex(t => t.id === activeId);
      let nextIndex = -1;

      if (e.key === 'ArrowRight') {
        nextIndex = (currentIndex + 1) % tabs.length;
      } else if (e.key === 'ArrowLeft') {
        nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
      } else if (e.key === 'Home') {
        nextIndex = 0;
      } else if (e.key === 'End') {
        nextIndex = tabs.length - 1;
      }

      if (nextIndex !== -1) {
        e.preventDefault();
        const nextTab = tabs[nextIndex];
        if (onSelect) onSelect(nextTab.id);
        const nextEl = tabElements[nextIndex];
        if (nextEl) nextEl.focus();
      }
    }
  });

  tabs.forEach((tab, index) => {
    const isSelected = tab.id === activeId;
    const tabEl = h('button', {
      type: 'button',
      role: 'tab',
      id: `tab-${tab.id}`,
      className: 'index-tab',
      'aria-selected': isSelected ? 'true' : 'false',
      tabindex: isSelected ? '0' : '-1',
      onClick: () => {
        if (onSelect) onSelect(tab.id);
      }
    }, tab.count !== undefined && tab.count > 0 ? `${tab.label} (${tab.count})` : tab.label);

    tabElements.push(tabEl);
    container.appendChild(tabEl);
  });

  return container;
}
