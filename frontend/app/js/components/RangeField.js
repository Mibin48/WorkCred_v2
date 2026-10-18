import { h } from '../utils/dom.js';

export function RangeField({
  id = 'range-field',
  label = 'Search radius',
  min = 1,
  max = 10,
  step = 1,
  value = 5,
  unit = 'km',
  onChange
}) {
  let currentVal = Number(value) || min;

  const valueDisplay = h('span', { className: 'range-value-display font-mono' }, `${currentVal} ${unit}`);

  const rangeInput = h('input', {
    id: `${id}-range`,
    type: 'range',
    min,
    max,
    step,
    value: currentVal,
    className: 'field-range',
    onInput: (e) => {
      syncValue(e.target.value);
    }
  });

  const numberInput = h('input', {
    id: `${id}-num`,
    type: 'number',
    min,
    max,
    step,
    value: currentVal,
    className: 'field-input field-input-sm',
    onInput: (e) => {
      syncValue(e.target.value);
    }
  });

  function syncValue(val) {
    let num = Number(val);
    if (isNaN(num)) return;
    if (num < min) num = min;
    if (num > max) num = max;

    currentVal = num;
    rangeInput.value = num;
    numberInput.value = num;
    valueDisplay.textContent = `${num} ${unit}`;

    if (onChange) onChange(num);
  }

  const controlsRow = h('div', { className: 'range-controls-row' },
    rangeInput,
    numberInput,
    valueDisplay
  );

  const container = h('div', { className: 'field-group' },
    h('label', { for: `${id}-range`, className: 'field-label' }, label),
    controlsRow
  );

  return {
    element: container,
    getValue: () => currentVal,
    setValue: (val) => syncValue(val)
  };
}
