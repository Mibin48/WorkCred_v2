import { h } from '../utils/dom.js';

export function SampleDataLabel() {
  return h('span', { className: 'sample-badge', role: 'note' },
    h('svg', {
      width: '12',
      height: '12',
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round'
    },
      h('path', { d: 'M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z' })
    ),
    h('span', null, 'Sample')
  );
}
