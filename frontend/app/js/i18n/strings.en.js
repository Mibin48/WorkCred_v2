/**
 * WorkCred English Strings Dictionary
 * Lives at: frontend/app/js/i18n/strings.en.js
 * Source of truth for all in-app user-facing microcopy.
 */

export const STRINGS_EN = {
  // Brand & Shell
  'app.name': 'WorkCred',
  'app.tagline': 'Proof of work, work near you.',
  'app.loading': 'Opening WorkCred…',
  'app.offline': 'You are offline. Some actions need an internet connection.',
  'app.online': 'Back online.',
  'app.notFoundTitle': 'Page not found',
  'app.notFoundMessage': 'This screen does not exist.',
  'app.goHome': 'Back to home',
  'app.hostMismatchTitle': 'Address mismatch',
  'app.hostMismatchMessage': 'Please open WorkCred using a single web address ({allowedHost}). Do not mix localhost and 127.0.0.1 in the same session.',

  // Navigation (Customer & Worker)
  'nav.find': 'Find',
  'nav.freeNow': 'Free now',
  'nav.postJob': 'Post job',
  'nav.bookings': 'Bookings',
  'nav.saved': 'Saved',
  'nav.home': 'Home',
  'nav.myWork': 'My work',
  'nav.passport': 'Passport',
  'nav.post': 'Post',
  'nav.me': 'Me',

  // Dev Banner
  'dev.bannerTitle': 'Development only: sample accounts',
  'dev.samplePasswordNote': 'Sample password (development only)',
  'dev.fillInEmail': 'Fill in email',
  'dev.fillInPassword': 'Fill in password',
  'dev.fillBoth': 'Fill in',

  // Auth: Common & Tabs
  'auth.workerTab': 'Worker',
  'auth.customerTab': 'Customer',
  'auth.loginTitle': 'Log in to your account',
  'auth.signupTitle': 'Create your account',
  'auth.emailLabel': 'Email',
  'auth.emailPlaceholder': 'e.g. ravi@example.com',
  'auth.phoneLabel': 'Phone number',
  'auth.phonePrefix': '+91',
  'auth.phonePlaceholder': '9876543210',
  'auth.phoneHintWorker': 'Customers can call you only after a booking is confirmed.',
  'auth.phoneHintCustomer': 'Workers can call you only after a booking is confirmed.',
  'auth.passwordLabel': 'Password',
  'auth.passwordPlaceholder': 'Your password',
  'auth.newPasswordLabel': 'New password',
  'auth.currentPasswordLabel': 'Current password',
  'auth.showPassword': 'Show',
  'auth.hidePassword': 'Hide',
  'auth.nameLabel': 'Full name',
  'auth.namePlaceholder': 'e.g. Ravi Kumar',
  'auth.loginButton': 'Log in',
  'auth.signupButton': 'Create account',
  'auth.loggingIn': 'Logging in…',
  'auth.signingUp': 'Creating account…',
  'auth.newHere': 'New here? Create an account',
  'auth.alreadyHaveAccount': 'Already have an account? Log in',
  'auth.forgotPasswordText': 'Forgot your password? Ask support to reset it. Self-service reset by email is coming later.',
  'auth.unverifiedNotice': 'We do not verify your email or phone yet.',
  'auth.logout': 'Log out',
  'auth.loggingOut': 'Logging out…',

  // Password Rules Checklist
  'rules.length': '8 to 64 characters',
  'rules.common': 'Not a common password',
  'rules.notNameOrPhone': 'Not your name, phone or email prefix',
  'rules.patterns': 'No repeated or sequential patterns',

  // Error mappings
  'error.invalidCredentials': 'Email or password is wrong.',
  'error.roleMismatch': 'This email is registered with a different role. Please switch tabs.',
  'error.accountLocked': 'Too many tries. Try again in {minutes} minutes.',
  'error.accountDisabled': 'This account has been disabled. Please contact support.',
  'error.rateLimited': 'Too many requests. Please slow down and try again shortly.',
  'error.emailTaken': 'This email is already registered. Try logging in.',
  'error.weakPassword': 'Password does not meet security requirements.',
  'error.network': 'Could not connect to the server. Check your connection.',
  'error.timeout': 'Request timed out. Please check your connection and try again.',
  'error.unknown': 'Something went wrong. Please try again.',
  'error.mustChangePassword': 'You must change your password before continuing.',

  // Onboarding: Common & Steps
  'onboarding.title': 'Welcome to WorkCred',
  'onboarding.subtitle': 'Let’s set up your profile so people can find you.',
  'onboarding.stepIndicator': 'Step {current} of {total}: {name}',
  'onboarding.unsavedNotice': 'Changes are saved to the server as you complete each step.',
  'onboarding.stepWorker1': 'Your skills',
  'onboarding.stepWorker2': 'Your rate',
  'onboarding.stepWorker3': 'Your area',
  'onboarding.stepWorker4': 'About you',
  'onboarding.stepReview': 'Review',
  'onboarding.stepCustomer1': 'Your details',
  'onboarding.stepCustomer2': 'Your area',
  'onboarding.nextStep': 'Save and continue',
  'onboarding.backStep': 'Back',
  'onboarding.finish': 'Finish',
  'onboarding.saving': 'Saving…',

  // Onboarding: Skills
  'onboarding.skillsTitle': 'What skills do you offer?',
  'onboarding.skillsHint': 'Pick 1 to 6 skills. Mark one as your main skill.',
  'onboarding.mainSkillLabel': 'Main skill',
  'onboarding.setMainSkill': 'Set as main',
  'onboarding.skillsError': 'Choose between 1 and 6 skills, with exactly one main skill.',

  // Onboarding: Rate & Compass
  'onboarding.rateTitle': 'What is your standard rate?',
  'onboarding.rateHint': 'Set an hourly rate, daily rate (8 hours), or both in whole rupees (₹50 to ₹1,00,000).',
  'onboarding.hourlyRateLabel': 'Hourly rate (₹)',
  'onboarding.dailyRateLabel': 'Daily rate (₹)',
  'onboarding.rateError': 'Enter at least one valid rate between ₹50 and ₹1,00,000.',
  'onboarding.compassTitle': 'Fair Rate Compass',
  'onboarding.compassCaption': 'Normal rate band for {skill} in {area}: ₹{p25} – ₹{p75}/hr (median ₹{median}/hr).',
  'onboarding.compassSampleNote': 'Based on sample rates for now.',
  'onboarding.compassPending': 'Set your main skill and area to see the normal rate band.',

  // Onboarding: Area & Location
  'onboarding.areaTitle': 'Where are you based?',
  'onboarding.areaHint': 'Choose your local area and how far you are willing to travel.',
  'onboarding.localityLabel': 'Area / Locality',
  'onboarding.chooseLocality': 'Choose your area…',
  'onboarding.useLocation': 'Use my location',
  'onboarding.locationPermissionNotice': 'We use your location only to find your nearest locality. We never share exact coordinates.',
  'onboarding.locationDenied': 'Location access was declined. Please pick your area from the list.',
  'onboarding.radiusLabel': 'Search radius',
  'onboarding.radiusValue': '{km} km',
  'onboarding.areaError': 'Please choose an area.',

  // Onboarding: About You & Photo
  'onboarding.aboutTitle': 'About you',
  'onboarding.aboutHint': 'Add an optional photo and a brief bio (up to 200 characters).',
  'onboarding.photoLabel': 'Profile photo',
  'onboarding.photoHint': 'JPEG, PNG or WebP, up to 20 MB. We resize it and remove location data before upload.',
  'onboarding.photoChoose': 'Choose photo',
  'onboarding.photoRemove': 'Remove photo',
  'onboarding.photoDisabled': 'Photo upload is not set up yet. You can add a photo later.',
  'onboarding.photoUploading': 'Processing and uploading photo…',
  'onboarding.bioLabel': 'Short bio',
  'onboarding.bioPlaceholder': 'e.g. Electrician with 10 years experience in domestic wiring.',
  'onboarding.bioCharCount': '{count}/200 characters',
  'onboarding.bioContactWarning': 'Do not include phone numbers, email addresses or links in your bio.',

  // Review Sheet
  'onboarding.reviewTitle': 'Review your profile',
  'onboarding.reviewReady': 'Everything looks ready! Tap Finish to start using WorkCred.',

  // Account
  'account.title': 'Account',
  'account.profileSummary': 'Profile summary',
  'account.roleLabel': 'Role',
  'account.editProfile': 'Edit profile',
  'account.changePassword': 'Change password',
  'account.changePasswordSuccess': 'Password changed successfully. Your other devices have been logged out.',
  'account.passwordChangedExplanation': 'Your password was changed. Please log in with your new password.',
  'account.forcePasswordTitle': 'Password change required',
  'account.forcePasswordMessage': 'For your security, you must set a new password before accessing your account.',
  'account.profileSaved': 'Profile updated successfully.',

  // Placeholders (Phase I1)
  'placeholder.title': '{title}',
  'placeholder.notice': 'This screen is built in a later step.',
  'placeholder.workerHomeMessage': 'Welcome, {name}! Your worker home feed and Free Now controls are coming in the next step.',
  'placeholder.customerFindMessage': 'Welcome, {name}! Search and booking tools are coming in the next step.',
  'placeholder.accountLink': 'View your account and profile'
};

/**
 * Translates key and interpolates parameters: {paramName}
 * @param {string} key 
 * @param {Record<string, string|number>} [params] 
 * @returns {string}
 */
export function t(key, params = {}) {
  const template = STRINGS_EN[key];
  if (!template) {
    console.warn(`[i18n] Missing translation for key: '${key}'`);
    return key;
  }

  return template.replace(/\{([a-zA-Z0-9_-]+)\}/g, (_, token) => {
    return params[token] !== undefined ? String(params[token]) : `{${token}}`;
  });
}
