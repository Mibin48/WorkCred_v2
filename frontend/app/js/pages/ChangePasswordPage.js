import { h } from '../utils/dom.js';
import { api } from '../api.js';
import { PasswordField } from '../components/PasswordField.js';
import { Button } from '../components/Button.js';
import { LedgerRule } from '../components/LedgerRule.js';
import { showToast } from '../components/Toast.js';
import { t } from '../i18n/strings.en.js';
import { navigate } from '../router.js';
import { getState, setState } from '../store.js';
import { validatePassword } from '../../../../shared/passwordRules.js';

export function ChangePasswordPage({ forced = false }) {
  const user = getState().user || {};
  let currentPassword = '';
  let newPassword = '';
  let isBusy = false;
  let currentPasswordError = '';
  let newPasswordError = '';
  let generalError = '';

  const container = h('div', { className: 'card card-surface' });

  function render() {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const titleText = forced ? t('account.forcePasswordTitle') : t('account.changePassword');
    const titleEl = h('h1', { className: 'heading-display mb-3' }, titleText);

    if (forced) {
      container.appendChild(h('p', { className: 'body-text mb-4' }, t('account.forcePasswordMessage')));
    }

    const curField = PasswordField({
      id: 'current-password',
      name: 'currentPassword',
      label: t('auth.currentPasswordLabel'),
      value: currentPassword,
      autoComplete: 'current-password',
      error: currentPasswordError,
      onInput: (e) => {
        currentPassword = e.target.value;
        currentPasswordError = '';
      }
    });

    const newField = PasswordField({
      id: 'new-password',
      name: 'newPassword',
      label: t('auth.newPasswordLabel'),
      value: newPassword,
      autoComplete: 'new-password',
      showChecklist: true,
      context: { name: user.name, phone: user.phone, email: user.email },
      error: newPasswordError,
      onInput: (e) => {
        newPassword = e.target.value;
        newPasswordError = '';
      }
    });

    const submitBtn = Button({
      label: isBusy ? 'Updating…' : t('account.changePassword'),
      variant: 'primary',
      fullWidth: true,
      isBusy,
      disabled: isBusy
    });

    const form = h('form', {
      onSubmit: async (e) => {
        e.preventDefault();
        generalError = '';
        currentPasswordError = '';
        newPasswordError = '';

        if (!currentPassword) {
          currentPasswordError = 'Please enter your current password.';
          render();
          container.querySelector('#current-password')?.focus();
          return;
        }

        const ruleCheck = validatePassword(newPassword, {
          name: user.name,
          phone: user.phone,
          email: user.email
        });

        if (!ruleCheck.valid) {
          newPasswordError = ruleCheck.error || t('error.weakPassword');
          render();
          container.querySelector('#new-password')?.focus();
          return;
        }

        isBusy = true;
        render();

        try {
          await api.changePassword(currentPassword, newPassword);
          isBusy = false;
          if (user.mustChangePassword) {
            setState({ user: { ...user, mustChangePassword: false } });
          }
          showToast(t('account.changePasswordSuccess'), 'success');
          navigate('/app/account');
        } catch (err) {
          isBusy = false;
          if (err.code === 'INVALID_CREDENTIALS') {
            currentPasswordError = 'Current password is incorrect.';
          } else {
            generalError = err.message || t('error.unknown');
          }
          render();
        }
      }
    },
      curField,
      newField,
      submitBtn
    );

    container.appendChild(titleEl);
    if (generalError) {
      container.appendChild(h('div', { className: 'field-error card mb-3', role: 'alert' }, generalError));
    }
    container.appendChild(form);

    if (!forced) {
      container.appendChild(LedgerRule());
      const cancelBtn = Button({
        label: 'Cancel',
        variant: 'quiet',
        fullWidth: true,
        onClick: () => navigate('/app/account')
      });
      container.appendChild(cancelBtn);
    }
  }

  render();
  return container;
}
