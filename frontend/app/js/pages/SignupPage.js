import { h } from '../utils/dom.js';
import { api } from '../api.js';
import { Field } from '../components/Field.js';
import { PasswordField } from '../components/PasswordField.js';
import { Button } from '../components/Button.js';
import { IndexTabs } from '../components/IndexTabs.js';
import { LedgerRule } from '../components/LedgerRule.js';
import { t } from '../i18n/strings.en.js';
import { navigate } from '../router.js';
import { setState } from '../store.js';
import { isValidName, isValidEmail, isValidIndianPhone } from '../../../../shared/validators.js';
import { validatePassword } from '../../../../shared/passwordRules.js';

export function SignupPage({ queryParams = {} }) {
  let role = queryParams.role === 'customer' ? 'customer' : 'worker';
  let nameVal = '';
  let emailVal = '';
  let phoneVal = '';
  let passwordVal = '';
  let isBusy = false;

  let generalError = '';
  let nameError = '';
  let emailError = '';
  let phoneError = '';
  let passwordError = '';

  const container = h('div', { className: 'auth-form-card card card-surface' });

  function render() {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const titleEl = h('h1', { className: 'heading-display text-center mb-3' }, t('auth.signupTitle'));

    const roleTabs = IndexTabs({
      tabs: [
        { id: 'worker', label: t('auth.workerTab') },
        { id: 'customer', label: t('auth.customerTab') }
      ],
      activeId: role,
      onSelect: (newRole) => {
        role = newRole;
        generalError = '';
        render();
      }
    });

    const nameField = Field({
      id: 'signup-name',
      name: 'name',
      type: 'text',
      label: t('auth.nameLabel'),
      placeholder: t('auth.namePlaceholder'),
      value: nameVal,
      required: true,
      autoComplete: 'name',
      error: nameError,
      onInput: (e) => {
        nameVal = e.target.value;
        nameError = '';
      }
    });

    const emailField = Field({
      id: 'signup-email',
      name: 'email',
      type: 'email',
      label: t('auth.emailLabel'),
      placeholder: t('auth.emailPlaceholder'),
      value: emailVal,
      required: true,
      autoComplete: 'email',
      inputMode: 'email',
      autoCapitalize: 'none',
      error: emailError,
      onInput: (e) => {
        emailVal = e.target.value;
        emailError = '';
      }
    });

    const phoneHint = role === 'worker' ? t('auth.phoneHintWorker') : t('auth.phoneHintCustomer');

    const phoneField = Field({
      id: 'signup-phone',
      name: 'phone',
      type: 'tel',
      label: t('auth.phoneLabel'),
      placeholder: t('auth.phonePlaceholder'),
      prefix: t('auth.phonePrefix'),
      hint: phoneHint,
      value: phoneVal,
      required: true,
      autoComplete: 'tel-national',
      inputMode: 'numeric',
      error: phoneError,
      onInput: (e) => {
        phoneVal = e.target.value;
        phoneError = '';
      }
    });

    const passwordField = PasswordField({
      id: 'signup-password',
      name: 'password',
      label: t('auth.passwordLabel'),
      value: passwordVal,
      required: true,
      autoComplete: 'new-password',
      showChecklist: true,
      context: { name: nameVal, phone: phoneVal, email: emailVal },
      error: passwordError,
      onInput: (e) => {
        passwordVal = e.target.value;
        passwordError = '';
      }
    });

    const submitBtn = Button({
      id: 'signup-submit-btn',
      label: isBusy ? t('auth.signingUp') : t('auth.signupButton'),
      type: 'submit',
      variant: 'primary',
      fullWidth: true,
      isBusy,
      disabled: isBusy
    });

    const form = h('form', {
      className: 'auth-form',
      onSubmit: async (e) => {
        e.preventDefault();
        generalError = '';
        nameError = '';
        emailError = '';
        phoneError = '';
        passwordError = '';

        // 1. Client-side validation using shared validators
        let hasClientError = false;
        let firstErrorInputId = null;

        if (!isValidName(nameVal)) {
          nameError = 'Name must be between 2 and 100 characters.';
          hasClientError = true;
          if (!firstErrorInputId) firstErrorInputId = 'signup-name';
        }

        if (!isValidEmail(emailVal)) {
          emailError = 'Please enter a valid email address.';
          hasClientError = true;
          if (!firstErrorInputId) firstErrorInputId = 'signup-email';
        }

        if (!isValidIndianPhone(phoneVal)) {
          phoneError = 'Please enter a valid 10-digit Indian phone number starting with 6-9.';
          hasClientError = true;
          if (!firstErrorInputId) firstErrorInputId = 'signup-phone';
        }

        const pwdResult = validatePassword(passwordVal, {
          name: nameVal,
          phone: phoneVal,
          email: emailVal
        });

        if (!pwdResult.valid) {
          passwordError = pwdResult.error || t('error.weakPassword');
          hasClientError = true;
          if (!firstErrorInputId) firstErrorInputId = 'signup-password';
        }

        if (hasClientError) {
          render();
          if (firstErrorInputId) {
            container.querySelector(`#${firstErrorInputId}`)?.focus();
          }
          return;
        }

        isBusy = true;
        render();

        try {
          const res = await api.signup({
            role,
            name: nameVal.trim(),
            email: emailVal.trim().toLowerCase(),
            phone: phoneVal.trim().replace(/\D/g, '').slice(-10),
            password: passwordVal
          });

          setState({ user: res.user });
          api.getMeta().then((meta) => {
            setState({ meta });
          }).catch(() => {});
          navigate('/app/onboarding');
        } catch (err) {
          isBusy = false;
          if (err.code === 'EMAIL_TAKEN') {
            emailError = t('error.emailTaken');
          } else if (err.code === 'WEAK_PASSWORD') {
            passwordError = err.message || t('error.weakPassword');
          } else if (err.details && Array.isArray(err.details)) {
            // Field specific details from backend
            for (const d of err.details) {
              const field = d.field || d.path;
              if (field === 'name') nameError = d.message;
              else if (field === 'email') emailError = d.message;
              else if (field === 'phone') phoneError = d.message;
              else if (field === 'password') passwordError = d.message;
            }
            if (!nameError && !emailError && !phoneError && !passwordError) {
              generalError = err.message || t('error.unknown');
            }
          } else {
            generalError = err.message || t('error.unknown');
          }

          render();
          const firstErr = container.querySelector('[aria-invalid="true"]');
          if (firstErr) firstErr.focus();
        }
      }
    },
      nameField,
      emailField,
      phoneField,
      passwordField,
      h('p', { className: 'field-hint mb-3' }, t('auth.unverifiedNotice')),
      submitBtn
    );

    const linksSection = h('div', { className: 'auth-links mt-4 text-center' },
      h('a', {
        href: '/app/login',
        className: 'btn btn-quiet',
        onClick: (e) => {
          e.preventDefault();
          navigate('/app/login');
        }
      }, t('auth.alreadyHaveAccount'))
    );

    container.appendChild(titleEl);
    container.appendChild(roleTabs);
    container.appendChild(h('div', { className: 'mt-4' }));

    if (generalError) {
      container.appendChild(h('div', {
        className: 'field-error card mb-3',
        role: 'alert',
        tabindex: '-1'
      }, generalError));
    }

    container.appendChild(form);
    container.appendChild(LedgerRule());
    container.appendChild(linksSection);
  }

  render();
  return container;
}
