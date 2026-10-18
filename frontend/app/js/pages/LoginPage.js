import { h } from '../utils/dom.js';
import { api } from '../api.js';
import { Field } from '../components/Field.js';
import { PasswordField } from '../components/PasswordField.js';
import { Button } from '../components/Button.js';
import { IndexTabs } from '../components/IndexTabs.js';
import { DevBanner } from '../components/DevBanner.js';
import { LedgerRule } from '../components/LedgerRule.js';
import { t } from '../i18n/strings.en.js';
import { navigate } from '../router.js';
import { setState } from '../store.js';

let sessionRoleTab = 'worker';

export function LoginPage() {
  let role = sessionRoleTab;
  let emailVal = '';
  let passwordVal = '';
  let isBusy = false;
  let generalError = '';
  let emailError = '';
  let passwordError = '';

  const container = h('div', { className: 'auth-form-card card card-surface' });

  function render() {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    const titleEl = h('h1', { className: 'heading-display text-center mb-3' }, t('auth.loginTitle'));

    // Role tabs
    const roleTabs = IndexTabs({
      tabs: [
        { id: 'worker', label: t('auth.workerTab') },
        { id: 'customer', label: t('auth.customerTab') }
      ],
      activeId: role,
      onSelect: (newRole) => {
        role = newRole;
        sessionRoleTab = newRole;
        generalError = '';
        render();
      }
    });

    const emailField = Field({
      id: 'login-email',
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

    const passwordField = PasswordField({
      id: 'login-password',
      name: 'password',
      label: t('auth.passwordLabel'),
      value: passwordVal,
      required: true,
      autoComplete: 'current-password',
      error: passwordError,
      onInput: (e) => {
        passwordVal = e.target.value;
        passwordError = '';
      }
    });

    const submitBtn = Button({
      id: 'login-submit-btn',
      label: isBusy ? t('auth.loggingIn') : t('auth.loginButton'),
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
        emailError = '';
        passwordError = '';

        if (!emailVal.trim()) {
          emailError = 'Please enter your email.';
          render();
          container.querySelector('#login-email')?.focus();
          return;
        }

        if (!passwordVal) {
          passwordError = 'Please enter your password.';
          render();
          container.querySelector('#login-password')?.focus();
          return;
        }

        isBusy = true;
        render();

        try {
          const res = await api.login(emailVal.trim(), passwordVal, role);
          // Check role tab match
          if (res.user && res.user.role !== role) {
            generalError = t('error.roleMismatch');
            isBusy = false;
            render();
            return;
          }

          setState({ user: res.user });

          // Fetch meta now that access token is stored
          api.getMeta().then((meta) => {
            setState({ meta });
          }).catch(() => {});

          if (res.user.mustChangePassword) {
            navigate('/app/account/password');
            return;
          }

          if (!res.user.profileComplete) {
            navigate('/app/onboarding');
            return;
          }

          navigate(role === 'worker' ? '/app/home' : '/app/find');
        } catch (err) {
          isBusy = false;
          if (err.code === 'INVALID_CREDENTIALS') {
            generalError = t('error.invalidCredentials');
          } else if (err.code === 'ROLE_MISMATCH') {
            generalError = err.message || t('error.roleMismatch');
          } else if (err.code === 'ACCOUNT_LOCKED') {
            const minutes = err.details?.minutes || 10;
            generalError = t('error.accountLocked', { minutes });
          } else if (err.code === 'ACCOUNT_DISABLED') {
            generalError = t('error.accountDisabled');
          } else if (err.code === 'RATE_LIMITED') {
            generalError = t('error.rateLimited');
          } else if (err.code === 'NETWORK_ERROR') {
            generalError = t('error.network');
          } else {
            generalError = err.message || t('error.unknown');
          }
          render();
          // Focus first error field or form
          const firstErr = container.querySelector('[aria-invalid="true"]');
          if (firstErr) firstErr.focus();
        }
      }
    },
      emailField,
      passwordField,
      submitBtn
    );

    // Dev accounts banner
    const devBanner = DevBanner({
      onFillCredentials: (creds) => {
        if (creds.email) emailVal = creds.email;
        if (creds.password) passwordVal = creds.password;
        if (creds.role) {
          role = creds.role;
          sessionRoleTab = creds.role;
        }
        render();
      }
    });

    const linksSection = h('div', { className: 'auth-links mt-4 text-center' },
      h('a', {
        href: `/app/signup?role=${role}`,
        className: 'btn btn-quiet',
        onClick: (e) => {
          e.preventDefault();
          navigate(`/app/signup?role=${role}`);
        }
      }, t('auth.newHere')),
      h('p', { className: 'field-hint mt-3' }, t('auth.forgotPasswordText'))
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

    container.appendChild(devBanner);
    container.appendChild(form);
    container.appendChild(LedgerRule());
    container.appendChild(linksSection);
  }

  render();
  return container;
}
