import { h } from './utils/dom.js';
import { getState, setState, subscribe } from './store.js';
import { checkHostSanity } from './api.js';
import { t } from './i18n/strings.en.js';

// Layouts
import { PublicLayout } from './layouts/PublicLayout.js';
import { AppLayout } from './layouts/AppLayout.js';
import { OnboardingLayout } from './layouts/OnboardingLayout.js';

// Pages
import { LoginPage } from './pages/LoginPage.js';
import { SignupPage } from './pages/SignupPage.js';
import { OnboardingPage } from './pages/OnboardingPage.js';
import { AccountPage } from './pages/AccountPage.js';
import { ChangePasswordPage } from './pages/ChangePasswordPage.js';
import { WorkerHomePage } from './pages/WorkerHomePage.js';
import { CustomerFindPage } from './pages/CustomerFindPage.js';
import { PlaceholderPage } from './pages/PlaceholderPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { HostMismatchPage } from './pages/HostMismatchPage.js';
import { ErrorState } from './components/ErrorState.js';

let rememberedRedirectPath = null;
let currentStepText = '';

export function getRememberedRedirect() {
  return rememberedRedirectPath;
}

export function clearRememberedRedirect() {
  rememberedRedirectPath = null;
}

export const ROUTES = [
  {
    path: '/app/login',
    title: 'Log in',
    layout: 'public',
    component: (params, query) => LoginPage()
  },
  {
    path: '/app/signup',
    title: 'Sign up',
    layout: 'public',
    component: (params, query) => SignupPage({ queryParams: query })
  },
  {
    path: '/app/onboarding',
    title: 'Onboarding',
    layout: 'onboarding',
    protected: true,
    component: () => OnboardingPage({
      onUpdateStepIndicator: (stepText) => {
        currentStepText = stepText;
        const indicator = document.querySelector('.onboarding-container')?.parentElement?.querySelector('.app-header .field-hint');
        if (indicator) indicator.textContent = stepText;
      }
    })
  },
  {
    path: '/app/account',
    title: 'Account',
    layout: 'app',
    activeTab: 'me',
    protected: true,
    component: () => AccountPage()
  },
  {
    path: '/app/account/password',
    title: 'Change password',
    layout: 'app',
    activeTab: 'me',
    protected: true,
    component: () => {
      const isForced = !!getState().user?.mustChangePassword;
      return ChangePasswordPage({ forced: isForced });
    }
  },
  // Worker routes
  {
    path: '/app/home',
    title: 'Home',
    layout: 'app',
    activeTab: 'home',
    protected: true,
    role: 'worker',
    component: () => WorkerHomePage()
  },
  {
    path: '/app/my-work',
    title: 'My work',
    layout: 'app',
    activeTab: 'my-work',
    protected: true,
    role: 'worker',
    component: () => PlaceholderPage({ title: 'My work' })
  },
  {
    path: '/app/passport',
    title: 'Work Passport',
    layout: 'app',
    activeTab: 'passport',
    protected: true,
    role: 'worker',
    component: () => PlaceholderPage({ title: 'Work Passport' })
  },
  {
    path: '/app/post',
    title: 'Post',
    layout: 'app',
    activeTab: 'post',
    protected: true,
    role: 'worker',
    component: () => PlaceholderPage({ title: 'Post' })
  },
  // Customer routes
  {
    path: '/app/find',
    title: 'Find workers',
    layout: 'app',
    activeTab: 'find',
    protected: true,
    role: 'customer',
    component: () => CustomerFindPage()
  },
  {
    path: '/app/free-now',
    title: 'Free now',
    layout: 'app',
    activeTab: 'free-now',
    protected: true,
    role: 'customer',
    component: () => PlaceholderPage({ title: 'Free now' })
  },
  {
    path: '/app/post-job',
    title: 'Post job',
    layout: 'app',
    activeTab: 'post-job',
    protected: true,
    role: 'customer',
    component: () => PlaceholderPage({ title: 'Post job' })
  },
  {
    path: '/app/bookings',
    title: 'Bookings',
    layout: 'app',
    activeTab: 'bookings',
    protected: true,
    role: 'customer',
    component: () => PlaceholderPage({ title: 'Bookings' })
  },
  {
    path: '/app/saved',
    title: 'Saved',
    layout: 'app',
    activeTab: 'saved',
    protected: true,
    role: 'customer',
    component: () => PlaceholderPage({ title: 'Saved' })
  }
];

export function parseUrl(urlStr) {
  try {
    const parsed = new URL(urlStr, window.location.origin);
    const path = parsed.pathname;
    const query = {};
    for (const [k, v] of parsed.searchParams.entries()) {
      query[k] = v;
    }
    return { path, query };
  } catch {
    return { path: urlStr, query: {} };
  }
}

/**
 * Route guard evaluation function
 * Evaluates in strict order per specification:
 * 1. Boot loading -> { action: 'loading' }
 * 2. Not logged in on protected route -> { action: 'redirect', to: '/app/login' }
 * 3. Logged in on /app/login or /app/signup -> { action: 'redirect', to: roleHome }
 * 4. mustChangePassword true -> force /app/account/password (unless already there or logging out)
 * 5. profileComplete false -> force /app/onboarding (except account, password, logout)
 * 6. profileComplete true on /app/onboarding -> { action: 'redirect', to: roleHome }
 * 7. Role guard -> { action: 'role_mismatch_404' }
 */
export function evaluateGuards(currentPath, state) {
  const { bootStatus, user } = state;

  if (bootStatus === 'loading') {
    return { action: 'loading' };
  }

  if (bootStatus === 'error') {
    return { action: 'boot_error' };
  }

  const route = ROUTES.find(r => r.path === currentPath);
  const isProtected = route ? !!route.protected : currentPath.startsWith('/app');
  const roleHome = user?.role === 'customer' ? '/app/find' : '/app/home';

  // 2. Not logged in on protected route
  if (!user && isProtected && currentPath !== '/app/login' && currentPath !== '/app/signup') {
    return { action: 'redirect', to: '/app/login', remember: currentPath };
  }

  // 3. Logged in on /app/login or /app/signup
  if (user && (currentPath === '/app/login' || currentPath === '/app/signup')) {
    if (user.mustChangePassword) {
      return { action: 'redirect', to: '/app/account/password' };
    }
    if (!user.profileComplete) {
      return { action: 'redirect', to: '/app/onboarding' };
    }
    return { action: 'redirect', to: roleHome };
  }

  if (user) {
    // 4. mustChangePassword true
    if (user.mustChangePassword && currentPath !== '/app/account/password' && currentPath !== '/app/account') {
      return { action: 'redirect', to: '/app/account/password' };
    }

    // 5. profileComplete false
    if (!user.profileComplete && !user.mustChangePassword) {
      if (currentPath !== '/app/onboarding' && !currentPath.startsWith('/app/account')) {
        return { action: 'redirect', to: '/app/onboarding' };
      }
    }

    // 6. profileComplete true on /app/onboarding
    if (user.profileComplete && currentPath === '/app/onboarding') {
      return { action: 'redirect', to: roleHome };
    }

    // 7. Role guard
    if (route && route.role && route.role !== user.role) {
      return { action: '404' };
    }
  }

  if (!route) {
    return { action: '404' };
  }

  return { action: 'render', route };
}

export function navigate(url, replace = false) {
  const { path, query } = parseUrl(url);

  if (replace) {
    window.history.replaceState({}, '', url);
  } else {
    window.history.pushState({}, '', url);
  }

  renderCurrentRoute();
}

export function renderCurrentRoute() {
  const root = document.getElementById('app-root');
  if (!root) return;

  // Check host sanity (M6)
  if (!checkHostSanity()) {
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(PublicLayout({ contentNode: HostMismatchPage() }));
    return;
  }

  const { path, query } = parseUrl(window.location.pathname + window.location.search);
  const state = getState();

  const decision = evaluateGuards(path, state);

  if (decision.action === 'loading') {
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(h('div', { className: 'app-viewport' },
      h('div', { className: 'app-frame centered-card-container' },
        h('h1', { className: 'heading-display skeleton-pulse' }, t('app.loading'))
      )
    ));
    return;
  }

  if (decision.action === 'boot_error') {
    while (root.firstChild) root.removeChild(root.firstChild);
    root.appendChild(h('div', { className: 'app-viewport' },
      h('div', { className: 'app-frame centered-card-container' },
        ErrorState({
          title: 'Connection error',
          message: 'Could not connect to the WorkCred server.',
          onRetry: () => {
            window.location.reload();
          }
        })
      )
    ));
    return;
  }

  if (decision.action === 'redirect') {
    if (decision.remember) {
      rememberedRedirectPath = decision.remember;
    }
    navigate(decision.to, true);
    return;
  }

  if (decision.action === '404') {
    while (root.firstChild) root.removeChild(root.firstChild);
    document.title = `${t('app.notFoundTitle')} · ${t('app.name')}`;
    const notFoundView = AppLayout({
      title: t('app.notFoundTitle'),
      user: state.user,
      activeTab: '',
      contentNode: NotFoundPage(),
      onNavigate: (p) => navigate(p)
    });
    root.appendChild(notFoundView);
    focusH1();
    return;
  }

  const { route } = decision;
  document.title = `${route.title} · ${t('app.name')}`;

  while (root.firstChild) root.removeChild(root.firstChild);

  const pageContent = route.component(null, query);

  let viewEl;
  if (route.layout === 'public') {
    viewEl = PublicLayout({ contentNode: pageContent });
  } else if (route.layout === 'onboarding') {
    viewEl = OnboardingLayout({
      stepText: currentStepText,
      contentNode: pageContent
    });
  } else {
    // AppLayout
    viewEl = AppLayout({
      title: route.title,
      user: state.user,
      activeTab: route.activeTab || 'home',
      counts: state.tabCounts || {},
      contentNode: pageContent,
      onNavigate: (p) => navigate(p),
      onAccountClick: () => navigate('/app/account')
    });
  }

  root.appendChild(viewEl);
  window.scrollTo(0, 0);
  focusH1();
}

function focusH1() {
  setTimeout(() => {
    const h1 = document.querySelector('h1');
    if (h1) {
      h1.setAttribute('tabindex', '-1');
      h1.focus();
    }
  }, 50);
}

// Global popstate & click interception
export function initRouter() {
  window.addEventListener('popstate', () => {
    renderCurrentRoute();
  });

  document.addEventListener('click', (e) => {
    const target = e.target.closest('a');
    if (!target) return;

    const href = target.getAttribute('href');
    if (!href) return;

    if (
      href.startsWith('/app') &&
      !target.hasAttribute('target') &&
      !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
    ) {
      e.preventDefault();
      navigate(href);
    }
  });

  subscribe(() => {
    renderCurrentRoute();
  });
}
