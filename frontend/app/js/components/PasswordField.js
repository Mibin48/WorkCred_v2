import { h } from '../utils/dom.js';
import { t } from '../i18n/strings.en.js';

export function PasswordField({
  id = 'password',
  name = 'password',
  label,
  value = '',
  placeholder = '',
  hint = '',
  error = '',
  required = true,
  autoComplete = 'current-password',
  showChecklist = false,
  context = {}, // { name, phone, email }
  onInput,
  ...props
}) {
  let isVisible = false;
  let currentVal = value;

  const inputEl = h('input', {
    id,
    name,
    type: 'password',
    value: currentVal,
    placeholder,
    required,
    autocomplete: autoComplete,
    className: 'field-input',
    'aria-invalid': error ? 'true' : 'false',
    onInput: (e) => {
      currentVal = e.target.value;
      if (showChecklist) {
        updateChecklist(currentVal);
      }
      if (onInput) onInput(e);
    },
    ...props
  });

  const toggleBtn = h('button', {
    type: 'button',
    className: 'password-toggle-btn',
    onClick: () => {
      isVisible = !isVisible;
      inputEl.setAttribute('type', isVisible ? 'text' : 'password');
      toggleBtn.textContent = isVisible ? t('auth.hidePassword') : t('auth.showPassword');
    }
  }, t('auth.showPassword'));

  const controlEl = h('div', { className: 'field-control' }, inputEl, toggleBtn);

  // Rules checklist items
  const ruleLenEl = h('li', { className: 'password-rule-item', 'data-passed': 'false' }, `○ ${t('rules.length')}`);
  const ruleCommonEl = h('li', { className: 'password-rule-item', 'data-passed': 'false' }, `○ ${t('rules.common')}`);
  const ruleCtxEl = h('li', { className: 'password-rule-item', 'data-passed': 'false' }, `○ ${t('rules.notNameOrPhone')}`);
  const rulePatternEl = h('li', { className: 'password-rule-item', 'data-passed': 'false' }, `○ ${t('rules.patterns')}`);

  const checklistEl = h('ul', { className: 'password-rules-list' },
    ruleLenEl,
    ruleCommonEl,
    ruleCtxEl,
    rulePatternEl
  );

  function updateChecklist(pwd) {
    const lenPass = pwd.length >= 8 && pwd.length <= 64;
    setRuleState(ruleLenEl, lenPass, t('rules.length'));

    // Common check (basic check)
    const commonSet = new Set(['password', '12345678', '123456789', 'workcred', 'welcome123', 'admin123', 'qwertyuiop']);
    const notCommonPass = pwd.length >= 8 && !commonSet.has(pwd.toLowerCase());
    setRuleState(ruleCommonEl, notCommonPass, t('rules.common'));

    // Context check
    let ctxPass = true;
    if (context.phone && pwd.includes(context.phone)) ctxPass = false;
    if (context.name && context.name.length >= 3 && pwd.toLowerCase().includes(context.name.toLowerCase())) ctxPass = false;
    if (context.email && pwd.toLowerCase().includes(context.email.split('@')[0].toLowerCase())) ctxPass = false;
    setRuleState(ruleCtxEl, pwd.length >= 8 && ctxPass, t('rules.notNameOrPhone'));

    // Pattern check (repeated/sequential)
    let patternPass = true;
    if (/(.)\1{3,}/.test(pwd.toLowerCase())) patternPass = false;
    setRuleState(rulePatternEl, pwd.length >= 8 && patternPass, t('rules.patterns'));
  }

  function setRuleState(el, passed, labelText) {
    el.setAttribute('data-passed', passed ? 'true' : 'false');
    el.textContent = `${passed ? '✓' : '○'} ${labelText}`;
  }

  const containerChildren = [
    h('label', { for: id, className: 'field-label' }, label || t('auth.passwordLabel')),
    controlEl
  ];

  if (hint) {
    containerChildren.push(h('div', { className: 'field-hint' }, hint));
  }

  if (error) {
    containerChildren.push(h('div', { className: 'field-error', role: 'alert' }, error));
  }

  if (showChecklist) {
    containerChildren.push(checklistEl);
    updateChecklist(currentVal);
  }

  return h('div', { className: 'field-group' }, ...containerChildren);
}
