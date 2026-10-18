import { h } from '../utils/dom.js';

export function Button({
  label,
  variant = 'primary', // 'primary' | 'secondary' | 'quiet' | 'danger'
  type = 'button',
  isBusy = false,
  fullWidth = false,
  disabled = false,
  id,
  onClick,
  ...props
}) {
  const classNames = ['btn', `btn-${variant}`];
  if (fullWidth) classNames.push('btn-full');

  let widthStyle = null;

  const btn = h('button', {
    type,
    id,
    className: classNames.join(' '),
    'aria-busy': isBusy ? 'true' : 'false',
    disabled: disabled || isBusy,
    onClick: (e) => {
      if (isBusy || disabled) {
        e.preventDefault();
        return;
      }
      if (onClick) onClick(e);
    },
    ...props
  }, label);

  return btn;
}
