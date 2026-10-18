import { h } from '../utils/dom.js';

export function SkeletonLine({ width = '100%', height = '1rem' }) {
  const el = h('div', {
    className: 'skeleton-line skeleton-pulse',
    'aria-hidden': 'true'
  });
  // Use data-width attribute for width style handling without inline style
  if (width === '50%') el.classList.add('w-50');
  else if (width === '75%') el.classList.add('w-75');
  return el;
}
