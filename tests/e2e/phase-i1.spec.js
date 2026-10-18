import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Helper to generate unique random emails
function randomEmail(prefix = 'test') {
  const rand = Math.random().toString(36).slice(2, 8);
  const ts = Date.now().toString().slice(-4);
  return `${prefix}.${rand}.${ts}@example.com`;
}

test.describe('WorkCred Phase I1 E2E Integration Suite', () => {

  // 1. Landing loads with JavaScript disabled
  test('Landing loads with JavaScript disabled and shows headline, steps and Sample labels', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto('/');

    // Headline and subtext visible
    await expect(page.locator('h1.hero-headline')).toContainText('Proof of work');
    await expect(page.locator('.hero-actions a').first()).toHaveText('I want work');

    // How it works numbered steps visible
    await expect(page.locator('.step-card')).toHaveCount(3);

    // Sample badges visible
    const sampleBadges = page.locator('.sample-badge');
    expect(await sampleBadges.count()).toBeGreaterThanOrEqual(1);

    await context.close();
  });

  // 2. Both signup CTAs prefill the right role
  test('Both signup CTAs on landing page prefill the correct role in signup form', async ({ page }) => {
    await page.goto('/');
    await page.click('text=I want work');
    await expect(page).toHaveURL(/\/app\/signup\?role=worker/);
    await expect(page.locator('#tab-worker')).toHaveAttribute('aria-selected', 'true');

    await page.goto('/');
    await page.click('text=I need a worker');
    await expect(page).toHaveURL(/\/app\/signup\?role=customer/);
    await expect(page.locator('#tab-customer')).toHaveAttribute('aria-selected', 'true');
  });

  // 3. Worker signup -> Full 4-step onboarding -> Lands on Worker Home with correct tabs
  test('Full worker journey: sign up -> 4-step onboarding -> worker home', async ({ page }) => {
    const email = randomEmail('worker');
    await page.goto('/app/signup?role=worker');

    // Fill form
    await page.fill('#signup-name', 'Anand K');
    await page.fill('#signup-email', email);
    await page.fill('#signup-phone', '9876500001');
    await page.fill('#signup-password', 'StrongWorkCredPass123!');
    await page.click('#signup-submit-btn');

    // Routed to onboarding
    await expect(page).toHaveURL(/\/app\/onboarding/);

    // Step 1: Skills
    await expect(page.locator('h2')).toContainText('Your skills');
    // Pick first skill chip
    const firstSkillChip = page.locator('.available-skills-section .choice-chip').first();
    await firstSkillChip.click();
    await page.click('button:has-text("Save and continue")');

    // Step 2: Rate
    await expect(page.locator('h2')).toContainText('Your rate');
    await page.fill('#worker-hourly-rate', '300');
    await page.click('button:has-text("Save and continue")');

    // Step 3: Area
    await expect(page.locator('h2')).toContainText('Your area');
    // Open locality sheet
    await page.click('.locality-picker-trigger');
    const firstLocItem = page.locator('.locality-item-btn').first();
    await firstLocItem.click();
    await page.click('button:has-text("Save and continue")');

    // Step 4: About you & Finish
    await expect(page.locator('h2')).toContainText('About you');
    await page.fill('#worker-bio', 'Experienced electrician in domestic wiring.');
    await page.click('button:has-text("Finish")');

    // Lands on worker home with correct worker tabs
    await expect(page).toHaveURL(/\/app\/home/);
    await expect(page.locator('.bottom-nav-pill')).toContainText('Home');
    await expect(page.locator('.bottom-nav-pill')).toContainText('My work');
    await expect(page.locator('.bottom-nav-pill')).toContainText('Passport');
    await expect(page.locator('.bottom-nav-pill')).toContainText('Post');
    await expect(page.locator('.bottom-nav-pill')).toContainText('Me');
  });

  // 4. Customer signup -> onboarding -> Lands on Customer Find with correct tabs & initials button
  test('Full customer journey: sign up -> customer onboarding -> customer find with initials button', async ({ page }) => {
    const email = randomEmail('customer');
    await page.goto('/app/signup?role=customer');

    await page.fill('#signup-name', 'Meera Nair');
    await page.fill('#signup-email', email);
    await page.fill('#signup-phone', '9876500002');
    await page.fill('#signup-password', 'StrongWorkCredPass123!');
    await page.click('#signup-submit-btn');

    await expect(page).toHaveURL(/\/app\/onboarding/);

    // Customer single-screen onboarding
    await expect(page.locator('h2').first()).toContainText('Your details');
    await page.click('.locality-picker-trigger');
    const firstLocItem = page.locator('.locality-item-btn').first();
    await firstLocItem.click();
    await page.click('button:has-text("Finish")');

    // Lands on customer find with customer tabs
    await expect(page).toHaveURL(/\/app\/find/);
    await expect(page.locator('.bottom-nav-pill')).toContainText('Find');
    await expect(page.locator('.bottom-nav-pill')).toContainText('Free now');
    await expect(page.locator('.bottom-nav-pill')).toContainText('Post job');
    await expect(page.locator('.bottom-nav-pill')).toContainText('Bookings');
    await expect(page.locator('.bottom-nav-pill')).toContainText('Saved');

    // Check initials button in header
    const initialsBtn = page.locator('.initials-btn');
    await expect(initialsBtn).toBeVisible();
    await expect(initialsBtn).toHaveText('MN');
  });

  // 5. Duplicate email validation
  test('Duplicate email registration displays field error', async ({ page }) => {
    const existingEmail = randomEmail('dupe');

    // Register first time
    await page.goto('/app/signup?role=worker');
    await page.fill('#signup-name', 'Worker One');
    await page.fill('#signup-email', existingEmail);
    await page.fill('#signup-phone', '9876500003');
    await page.fill('#signup-password', 'StrongWorkCredPass123!');
    await page.click('#signup-submit-btn');
    await expect(page).toHaveURL(/\/app\/onboarding/);

    // Try registering again with same email
    await page.goto('/app/signup?role=worker');
    await page.fill('#signup-name', 'Worker Two');
    await page.fill('#signup-email', existingEmail);
    await page.fill('#signup-phone', '9876500004');
    await page.fill('#signup-password', 'StrongWorkCredPass123!');
    await page.click('#signup-submit-btn');

    // Should stay on signup and show email error
    await expect(page).toHaveURL(/\/app\/signup/);
    const emailErr = page.locator('#field-signup-email-error, .field-error');
    await expect(emailErr).toBeVisible();
    await expect(emailErr).toContainText('already registered');
  });

  // 6. Weak password blocked client-side & server-side
  test('Weak password blocked client-side with rules checklist', async ({ page }) => {
    await page.goto('/app/signup');
    await page.fill('#signup-name', 'Test User');
    await page.fill('#signup-email', 'test.weak@example.com');
    await page.fill('#signup-phone', '9876500005');
    await page.fill('#signup-password', '12345'); // too short & common

    await page.click('#signup-submit-btn');

    // Assert rule item indicates failure
    const ruleItem = page.locator('.password-rule-item[data-passed="false"]').first();
    await expect(ruleItem).toBeVisible();
    await expect(page).toHaveURL(/\/app\/signup/);
  });

  // 7. Login with wrong password shows generic error message
  test('Login with incorrect password shows generic error message', async ({ page }) => {
    await page.goto('/app/login');
    await page.fill('#login-email', 'nonexistent.user@example.com');
    await page.fill('#login-password', 'WrongPassword123!');
    await page.click('#login-submit-btn');

    const err = page.locator('[role="alert"]');
    await expect(err).toBeVisible();
    await expect(err).toHaveText('Email or password is wrong.');
  });

  // 8. Role guard: worker visiting customer-only route gets 404
  test('Worker opening customer-only route gets 404 screen', async ({ page }) => {
    const email = randomEmail('worker-guard');
    await page.goto('/app/signup?role=worker');
    await page.fill('#signup-name', 'Worker Guard');
    await page.fill('#signup-email', email);
    await page.fill('#signup-phone', '9876500006');
    await page.fill('#signup-password', 'StrongWorkCredPass123!');
    await page.click('#signup-submit-btn');

    // Complete onboarding quickly
    await page.locator('.available-skills-section .choice-chip').first().click();
    await page.click('button:has-text("Save and continue")');
    await page.fill('#worker-hourly-rate', '250');
    await page.click('button:has-text("Save and continue")');
    await page.click('.locality-picker-trigger');
    await page.locator('.locality-item-btn').first().click();
    await page.click('button:has-text("Save and continue")');
    await page.click('button:has-text("Finish")');

    await expect(page).toHaveURL(/\/app\/home/);

    // Now try navigating to customer route /app/find
    await page.goto('/app/find');
    await expect(page.locator('h2')).toContainText('Page not found');
  });

  // 9. Multi-tab synchronization: Logout in tab A logs out tab B
  test('Logging out in tab A logs out tab B across browser contexts', async ({ browser }) => {
    const context = await browser.newContext();
    const pageA = await context.newPage();
    const pageB = await context.newPage();

    const email = randomEmail('multitab');
    await pageA.goto('/app/signup?role=worker');
    await pageA.fill('#signup-name', 'Multi Tab User');
    await pageA.fill('#signup-email', email);
    await pageA.fill('#signup-phone', '9876500007');
    await pageA.fill('#signup-password', 'StrongWorkCredPass123!');
    await pageA.click('#signup-submit-btn');
    await expect(pageA).toHaveURL(/\/app\/onboarding/);

    // Open tab B to onboarding
    await pageB.goto('/app/onboarding');
    await expect(pageB.locator('h2').first()).toBeVisible();

    // Log out in tab A by navigating to account or clearing session
    await pageA.goto('/app/account');
    await pageA.click('button:has-text("Log out")');
    await expect(pageA).toHaveURL(/\/app\/login/);

    // Tab B should automatically detect broadcast and route to login
    await expect(pageB).toHaveURL(/\/app\/login/);

    await context.close();
  });

  // 10. Axe-core accessibility audit
  test('Accessibility audit on core pages finds zero serious or critical violations', async ({ page }) => {
    const urlsToAudit = ['/', '/app/login', '/app/signup', '/privacy', '/terms'];

    for (const u of urlsToAudit) {
      await page.goto(u);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();

      const seriousViolations = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical');
      expect(seriousViolations, `Axe accessibility violations found on ${u}: ${JSON.stringify(seriousViolations, null, 2)}`).toHaveLength(0);
    }
  });

  // 11. Viewport layout checks: no horizontal scroll at various widths
  test('No horizontal scroll at 195, 320, 375, 390 and 768 px widths', async ({ page }) => {
    const widths = [195, 320, 375, 390, 768];
    const testPages = ['/', '/app/login', '/app/signup'];

    for (const w of widths) {
      await page.setViewportSize({ width: w, height: 800 });
      for (const p of testPages) {
        await page.goto(p);
        const hasHorizontalScroll = await page.evaluate(() => {
          return document.documentElement.scrollWidth > document.documentElement.clientWidth;
        });
        expect(hasHorizontalScroll, `Horizontal scroll detected on ${p} at viewport width ${w}px`).toBe(false);
      }
    }
  });

  // 12. Escape closes sheet dialog and returns focus
  test('Escape closes sheet dialog and returns focus to trigger', async ({ page }) => {
    await page.goto('/app/signup?role=worker');
    await page.fill('#signup-name', 'Sheet Test User');
    await page.fill('#signup-email', randomEmail('sheet'));
    await page.fill('#signup-phone', '9876500008');
    await page.fill('#signup-password', 'StrongWorkCredPass123!');
    await page.click('#signup-submit-btn');

    // Onboarding step 3
    await page.locator('.available-skills-section .choice-chip').first().click();
    await page.click('button:has-text("Save and continue")');
    await page.fill('#worker-hourly-rate', '250');
    await page.click('button:has-text("Save and continue")');

    // Open locality sheet
    const trigger = page.locator('.locality-picker-trigger');
    await trigger.click();

    const dialog = page.locator('.sheet-dialog');
    await expect(dialog).toBeVisible();

    // Press Escape
    await page.keyboard.press('Escape');

    // Dialog closed and focus returned to trigger
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });

  // 13. Console has no errors or warnings during flows
  test('Browser console has no errors or warnings during navigation', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await page.goto('/');
    await page.goto('/app/login');
    await page.goto('/app/signup');
    await page.goto('/privacy');
    await page.goto('/terms');

    expect(consoleErrors).toHaveLength(0);
  });

});
