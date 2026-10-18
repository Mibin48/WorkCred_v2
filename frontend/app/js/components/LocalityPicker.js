import { h } from '../utils/dom.js';
import { Sheet } from './Sheet.js';
import { Button } from './Button.js';
import { t } from '../i18n/strings.en.js';

export function LocalityPicker({
  value = '',
  localities = [],
  onSelectLocality,
  onCoordsResolved
}) {
  let selectedKey = value;
  let filterText = '';

  const triggerLabel = h('span', { className: 'locality-picker-label' },
    getLocalityName(selectedKey) || t('onboarding.chooseLocality')
  );

  const triggerBtn = h('button', {
    type: 'button',
    className: 'field-input locality-picker-trigger text-left',
    onClick: () => sheet.open()
  }, triggerLabel);

  const searchInput = h('input', {
    type: 'search',
    className: 'field-input',
    placeholder: 'Search area…',
    onInput: (e) => {
      filterText = e.target.value.toLowerCase();
      renderList();
    }
  });

  const listContainer = h('div', { className: 'locality-list' });

  // Use my location action
  const locationBtn = Button({
    label: t('onboarding.useLocation'),
    variant: 'secondary',
    fullWidth: true,
    onClick: () => {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            const lat = pos.coords.latitude;
            const lng = pos.coords.longitude;
            if (lat < 6 || lat > 38 || lng < 68 || lng > 98) {
              alert('location coordinates must be within India bounds (lat: 6-38, lng: 68-98)');
              return;
            }
            const coords = { lat, lng };
            if (onCoordsResolved) onCoordsResolved(coords);
            sheet.close();
          },
          (err) => {
            alert(t('onboarding.locationDenied'));
          }
        );
      } else {
        alert(t('onboarding.locationDenied'));
      }
    }
  });

  const sheetContent = h('div', { className: 'locality-sheet-body' },
    locationBtn,
    h('div', { className: 'ledger-rule' }),
    searchInput,
    listContainer
  );

  const sheet = Sheet({
    title: t('onboarding.areaTitle'),
    contentNode: sheetContent,
    hasInput: true
  });

  function getLocalityName(key) {
    const found = localities.find(l => l.key === key);
    return found ? found.name : key;
  }

  function renderList() {
    while (listContainer.firstChild) {
      listContainer.removeChild(listContainer.firstChild);
    }

    const filtered = localities.filter(loc =>
      !filterText || loc.name.toLowerCase().includes(filterText) || loc.key.toLowerCase().includes(filterText)
    );

    if (filtered.length === 0) {
      listContainer.appendChild(h('div', { className: 'body-text p-3 text-center' }, 'No areas match your search.'));
      return;
    }

    filtered.forEach(loc => {
      const isSelected = (loc.key === selectedKey);
      const row = h('button', {
        type: 'button',
        className: 'locality-item-btn',
        'aria-selected': isSelected ? 'true' : 'false',
        onClick: () => {
          selectedKey = loc.key;
          triggerLabel.textContent = loc.name;
          if (onSelectLocality) onSelectLocality(loc.key);
          sheet.close();
        }
      }, loc.name);

      listContainer.appendChild(row);
    });
  }

  renderList();

  const container = h('div', { className: 'field-group' },
    h('label', { className: 'field-label' }, t('onboarding.localityLabel')),
    triggerBtn
  );

  return {
    element: container,
    setValue: (newKey) => {
      selectedKey = newKey;
      triggerLabel.textContent = getLocalityName(newKey) || t('onboarding.chooseLocality');
    }
  };
}
