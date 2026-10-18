import { h } from '../utils/dom.js';

export function Field({
  id,
  name,
  label,
  type = 'text',
  value = '',
  placeholder = '',
  hint = '',
  error = '',
  required = false,
  readOnly = false,
  disabled = false,
  autoComplete,
  inputMode,
  autoCapitalize,
  prefix = '',
  onInput,
  onChange,
  onBlur,
  ...props
}) {
  const inputId = id || `field-${name || Math.random().toString(36).slice(2)}`;
  const hintId = hint ? `${inputId}-hint` : null;
  const errorId = error ? `${inputId}-error` : null;

  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  const inputClassNames = ['field-input'];
  if (prefix) inputClassNames.push('field-input-prefixed');

  const inputEl = h('input', {
    id: inputId,
    name: name || inputId,
    type,
    value,
    placeholder,
    required,
    readonly: readOnly,
    disabled,
    autocomplete: autoComplete,
    inputmode: inputMode,
    autocapitalize: autoCapitalize,
    className: inputClassNames.join(' '),
    'aria-describedby': describedBy,
    'aria-invalid': error ? 'true' : 'false',
    onInput,
    onChange,
    onBlur,
    ...props
  });

  const children = [
    h('label', { for: inputId, className: 'field-label' }, label),
    h('div', { className: 'field-control' },
      prefix ? h('span', { className: 'field-prefix' }, prefix) : null,
      inputEl
    )
  ];

  if (hint) {
    children.push(h('div', { id: hintId, className: 'field-hint' }, hint));
  }

  if (error) {
    children.push(h('div', { id: errorId, className: 'field-error', role: 'alert' },
      h('svg', {
        className: 'field-error-icon',
        width: '14',
        height: '14',
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '2'
      },
        h('circle', { cx: '12', cy: '12', r: '10' }),
        h('line', { x1: '12', y1: '8', x2: '12', y2: '12' }),
        h('line', { x1: '12', y1: '16', x2: '12.01', y2: '16' })
      ),
      h('span', null, error)
    ));
  }

  return h('div', { className: 'field-group' }, ...children);
}
