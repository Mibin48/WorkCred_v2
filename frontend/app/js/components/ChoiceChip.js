import { h } from '../utils/dom.js';

export function ChoiceChip({
  id,
  label,
  value,
  isPressed = false,
  onClick,
  ...props
}) {
  return h('button', {
    type: 'button',
    id,
    className: 'choice-chip',
    'aria-pressed': isPressed ? 'true' : 'false',
    'data-value': value || label,
    onClick: (e) => {
      if (onClick) onClick(e, value || label);
    },
    ...props
  }, label);
}
