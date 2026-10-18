import { h } from '../utils/dom.js';
import { ChoiceChip } from './ChoiceChip.js';
import { t } from '../i18n/strings.en.js';

export function SkillPicker({
  skills = [],
  selectedSkills = [],
  mainSkill = '',
  onChange
}) {
  // Normalize skills list: array of strings or { key, name }
  const normalizedSkills = (skills && skills.length > 0 ? skills : [
    'helper', 'electrician', 'plumber', 'mason', 'painter',
    'carpenter', 'cook', 'cleaner', 'driver', 'vendor', 'other'
  ]).map(s => {
    if (typeof s === 'string') {
      const formattedName = s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');
      return { key: s, name: formattedName };
    }
    return {
      key: s.key || s.id || String(s),
      name: s.name || s.label || (s.key ? s.key.charAt(0).toUpperCase() + s.key.slice(1) : String(s))
    };
  });

  let currentSelected = [...selectedSkills];
  let currentMain = mainSkill || (currentSelected[0] || '');

  const container = h('div', { className: 'skill-picker-container' });

  function notifyChange() {
    if (onChange) {
      onChange({
        skills: currentSelected,
        mainSkill: currentMain
      });
    }
  }

  function render() {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    // Selected section
    if (currentSelected.length > 0) {
      const selectedGroup = h('div', { className: 'selected-skills-section' },
        h('div', { className: 'field-label' }, `Selected skills (${currentSelected.length}/6)`),
        h('div', { className: 'chips-group' })
      );

      const chipsBox = selectedGroup.querySelector('.chips-group');

      currentSelected.forEach(skillKey => {
        const isMain = (skillKey === currentMain);
        const skillObj = normalizedSkills.find(s => s.key === skillKey) || {
          key: skillKey,
          name: skillKey.charAt(0).toUpperCase() + skillKey.slice(1).replace(/_/g, ' ')
        };

        const label = isMain ? `${skillObj.name} ★ (Main)` : skillObj.name;

        const chip = ChoiceChip({
          label,
          value: skillKey,
          isPressed: true,
          onClick: () => {
            // If already main, or only 1 left
            if (currentSelected.length === 1) return;
            currentSelected = currentSelected.filter(s => s !== skillKey);
            if (currentMain === skillKey) {
              currentMain = currentSelected[0] || '';
            }
            render();
            notifyChange();
          }
        });

        // Set main button if not already main
        if (!isMain) {
          const setMainBtn = h('button', {
            type: 'button',
            className: 'btn btn-quiet',
            onClick: () => {
              currentMain = skillKey;
              render();
              notifyChange();
            }
          }, t('onboarding.setMainSkill'));
          chipsBox.appendChild(h('div', { className: 'skill-item-pair' }, chip, setMainBtn));
        } else {
          chipsBox.appendChild(chip);
        }
      });

      container.appendChild(selectedGroup);
      container.appendChild(h('div', { className: 'ledger-rule' }));
    }

    // Available skills
    const availableGroup = h('div', { className: 'available-skills-section' },
      h('div', { className: 'field-label' }, t('onboarding.skillsTitle')),
      h('p', { className: 'field-hint' }, t('onboarding.skillsHint')),
      h('div', { className: 'chips-group' })
    );

    const availableBox = availableGroup.querySelector('.chips-group');

    normalizedSkills.forEach(skillObj => {
      const isSelected = currentSelected.includes(skillObj.key);
      if (isSelected) return; // already in selected section

      const chip = ChoiceChip({
        label: skillObj.name,
        value: skillObj.key,
        isPressed: false,
        onClick: () => {
          if (currentSelected.length >= 6) return;
          currentSelected.push(skillObj.key);
          if (!currentMain) currentMain = skillObj.key;
          render();
          notifyChange();
        }
      });

      availableBox.appendChild(chip);
    });

    container.appendChild(availableGroup);
  }

  render();

  return {
    element: container,
    getSelected: () => ({ skills: currentSelected, mainSkill: currentMain }),
    setSelected: (skillsArr, main) => {
      currentSelected = [...skillsArr];
      currentMain = main || currentSelected[0] || '';
      render();
    }
  };
}
