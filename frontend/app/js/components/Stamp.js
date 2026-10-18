import { h } from '../utils/dom.js';

export function Stamp({ recordsCount = 12 }) {
  return h('div', { className: 'stamp', role: 'note' },
    h('svg', {
      width: '14',
      height: '14',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '3',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    },
      h('polyline', { points: '20 6 9 17 4 12' })
    ),
    h('span', null, `History checked: Valid, ${recordsCount} records`)
  );
}
