import { refreshSession, api } from './api.js';
import { setState } from './store.js';
import { initRouter, renderCurrentRoute, navigate, getRememberedRedirect, clearRememberedRedirect } from './router.js';

async function bootApp() {
  initRouter();

  // Handle cross-tab logout & password-changed
  window.addEventListener('workcred:auth:logout', () => {
    setState({ user: null });
    navigate('/app/login');
  });

  window.addEventListener('workcred:auth:password-changed', () => {
    navigate('/app/login');
  });

  window.addEventListener('workcred:session:proactive-refresh', async () => {
    try {
      await refreshSession();
    } catch (err) {
      console.warn('[session] Proactive refresh failed:', err);
    }
  });

  try {
    // 1. Attempt silent refresh using HttpOnly cookie
    await refreshSession();

    // 2. Load user and meta in parallel
    const [userRes, meta] = await Promise.all([
      api.getMe(),
      api.getMeta().catch(() => ({ skills: [], localities: [] }))
    ]);

    const user = userRes?.user || userRes;

    setState({
      bootStatus: 'ready',
      user,
      meta,
      bootError: null
    });

    const redirectPath = getRememberedRedirect();
    if (redirectPath) {
      clearRememberedRedirect();
      navigate(redirectPath, true);
    } else {
      renderCurrentRoute();
    }
  } catch (err) {
    if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT') {
      setState({
        bootStatus: 'error',
        bootError: err,
        user: null
      });
      renderCurrentRoute();
      return;
    }

    // Refresh returned 401/SESSION_INVALID -> user is not logged in
    setState({
      bootStatus: 'ready',
      user: null,
      meta: { skills: [], localities: [] },
      bootError: null
    });
    renderCurrentRoute();
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootApp);
} else {
  bootApp();
}
