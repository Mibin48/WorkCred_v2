import { h } from '../utils/dom.js';

export function Wordmark({ href = '/', inverted = false }) {
  const symbol = h('svg', {
    width: '18',
    height: '18',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2.5',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    className: 'wordmark-symbol'
  },
    h('path', { d: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20' }),
    h('polyline', { points: '6 9 10 13 18 5' })
  );

  const text = h('span', { className: 'wordmark-text' }, 'WorkCred');

  const containerClass = inverted ? 'wordmark wordmark-inverted' : 'wordmark';

  if (href) {
    return h('a', { href, className: containerClass, 'aria-label': 'WorkCred Home' }, symbol, text);
  }
  return h('span', { className: containerClass }, symbol, text);
}
