import { h } from '../utils/dom.js';
import { api } from '../api.js';
import { Button } from '../components/Button.js';
import { Field } from '../components/Field.js';
import { SkillPicker } from '../components/SkillPicker.js';
import { LocalityPicker } from '../components/LocalityPicker.js';
import { RangeField } from '../components/RangeField.js';
import { CompassBar } from '../components/CompassBar.js';
import { Sheet } from '../components/Sheet.js';
import { LedgerRule } from '../components/LedgerRule.js';
import { showToast } from '../components/Toast.js';
import { t } from '../i18n/strings.en.js';
import { navigate } from '../router.js';
import { getState, setState } from '../store.js';
import { processAndUploadAvatar } from '../utils/uploader.js';
import { containsContactInfo } from '../../../../shared/containsContactInfo.js';

export function OnboardingPage({ onUpdateStepIndicator }) {
  const state = getState();
  let rawUser = state.user || {};
  while (rawUser && rawUser.user && typeof rawUser.user === 'object') {
    rawUser = rawUser.user;
  }
  const user = rawUser;
  let meta = state.meta || { skills: [], localities: [] };

  // If meta.skills is empty, trigger an async fetch and re-render when ready
  if (!meta.skills || meta.skills.length === 0) {
    api.getMeta().then((fetched) => {
      if (fetched && fetched.skills) {
        meta = fetched;
        setState({ meta: fetched });
        render();
      }
    }).catch(() => {});
  }

  const isWorker = user.role === 'worker';

  // Determine initial step for worker
  let currentStep = 1;
  if (isWorker) {
    if (!user.skills || user.skills.length === 0) {
      currentStep = 1;
    } else if (!user.hourlyRate && !user.dailyRate) {
      currentStep = 2;
    } else if (!user.localityKey) {
      currentStep = 3;
    } else {
      currentStep = 4;
    }
  }

  // Local state prefilled from user
  let skills = user.skills
    ? user.skills.map(s => (typeof s === 'string' ? s : s?.skill)).filter(Boolean)
    : [];
  let mainSkill = user.mainSkill || (skills[0] || '');
  let hourlyRate = user.hourlyRate || '';
  let dailyRate = user.dailyRate || '';
  let localityKey = user.localityKey || '';
  let radiusKm = user.radiusKm || 5;
  let bio = user.bio || '';
  let photoUrl = user.photoUrl || '';

  // Customer state
  let customerName = user.name || '';
  let customerPhone = user.phone || '';

  let isSaving = false;
  let stepError = '';
  let uploadDisabled = false;
  let uploadStatusText = '';

  const container = h('div', { className: 'onboarding-card card card-surface' });

  function updateHeader() {
    if (onUpdateStepIndicator) {
      if (isWorker) {
        const stepNames = [
          t('onboarding.stepWorker1'),
          t('onboarding.stepWorker2'),
          t('onboarding.stepWorker3'),
          t('onboarding.stepWorker4')
        ];
        onUpdateStepIndicator(t('onboarding.stepIndicator', {
          current: currentStep,
          total: 4,
          name: stepNames[currentStep - 1]
        }));
      } else {
        onUpdateStepIndicator(t('onboarding.stepCustomer1'));
      }
    }
  }

  // --- Step 1: Worker Skills ---
  function renderWorkerStep1() {
    updateHeader();

    const picker = SkillPicker({
      skills: meta.skills || [],
      selectedSkills: skills,
      mainSkill,
      onChange: (sel) => {
        skills = sel.skills;
        mainSkill = sel.mainSkill;
        stepError = '';
      }
    });

    const nextBtn = Button({
      label: isSaving ? t('onboarding.saving') : t('onboarding.nextStep'),
      variant: 'primary',
      fullWidth: true,
      isBusy: isSaving,
      disabled: isSaving,
      onClick: async () => {
        if (skills.length === 0 || skills.length > 6 || !mainSkill) {
          stepError = t('onboarding.skillsError');
          render();
          return;
        }

        isSaving = true;
        render();

        try {
          const skillsPayload = skills.map(s => ({
            skill: s,
            isMain: s === mainSkill
          }));
          const updated = await api.updateMe({ skills: skillsPayload });
          setState({ user: updated.user || updated });
          currentStep = 2;
          isSaving = false;
          stepError = '';
          render();
        } catch (err) {
          isSaving = false;
          stepError = err.message || t('error.unknown');
          render();
        }
      }
    });

    return h('div', { className: 'onboarding-step' },
      h('h2', { className: 'heading-display mb-2' }, t('onboarding.stepWorker1')),
      h('p', { className: 'body-text mb-4' }, t('onboarding.skillsHint')),
      picker.element,
      h('div', { className: 'mt-4' }),
      nextBtn
    );
  }

  // --- Step 2: Worker Rate ---
  function renderWorkerStep2() {
    updateHeader();

    let compassNode = h('div', { className: 'compass-slot' });

    function loadCompass() {
      if (mainSkill && localityKey) {
        api.getCompass({ skill: mainSkill, localityKey }).then(res => {
          const compData = res?.data || res;
          if (compData && compData.p25) {
            const effectiveRate = hourlyRate ? Number(hourlyRate) : (dailyRate ? Math.round(Number(dailyRate) / 8) : null);
            const localityObj = meta.localities?.find(l => l.key === localityKey);
            const areaName = localityObj ? localityObj.name : localityKey;

            const cBar = CompassBar({
              p25: compData.p25,
              median: compData.median,
              p75: compData.p75,
              userRate: effectiveRate,
              skill: compData.skill || mainSkill,
              area: areaName,
              isSample: compData.isSample || false
            });
            while (compassNode.firstChild) compassNode.removeChild(compassNode.firstChild);
            compassNode.appendChild(cBar);
          }
        }).catch(() => {
          // Hide silently
        });
      } else {
        while (compassNode.firstChild) compassNode.removeChild(compassNode.firstChild);
        compassNode.appendChild(h('div', { className: 'field-hint font-italic mb-3' }, t('onboarding.compassPending')));
      }
    }

    loadCompass();

    const hourlyField = Field({
      id: 'worker-hourly-rate',
      label: t('onboarding.hourlyRateLabel'),
      type: 'number',
      min: 50,
      max: 100000,
      step: 1,
      placeholder: 'e.g. 250',
      value: hourlyRate,
      onInput: (e) => {
        hourlyRate = e.target.value;
        stepError = '';
        loadCompass();
      }
    });

    const dailyField = Field({
      id: 'worker-daily-rate',
      label: t('onboarding.dailyRateLabel'),
      type: 'number',
      min: 50,
      max: 100000,
      step: 1,
      placeholder: 'e.g. 1500',
      value: dailyRate,
      onInput: (e) => {
        dailyRate = e.target.value;
        stepError = '';
        loadCompass();
      }
    });

    const nextBtn = Button({
      label: isSaving ? t('onboarding.saving') : t('onboarding.nextStep'),
      variant: 'primary',
      fullWidth: true,
      isBusy: isSaving,
      disabled: isSaving,
      onClick: async () => {
        const hNum = hourlyRate ? parseInt(hourlyRate, 10) : null;
        const dNum = dailyRate ? parseInt(dailyRate, 10) : null;

        if (!hNum && !dNum) {
          stepError = t('onboarding.rateError');
          render();
          return;
        }

        if ((hNum && (hNum < 50 || hNum > 100000)) || (dNum && (dNum < 50 || dNum > 100000))) {
          stepError = t('onboarding.rateError');
          render();
          return;
        }

        isSaving = true;
        render();

        try {
          const patch = {};
          if (hNum) patch.hourlyRate = hNum;
          if (dNum) patch.dailyRate = dNum;

          const updated = await api.updateMe(patch);
          const updatedUser = updated.user || updated;
          setState({ user: updatedUser });
          currentStep = 3;
          isSaving = false;
          stepError = '';
          render();
        } catch (err) {
          isSaving = false;
          stepError = err.message || t('error.unknown');
          render();
        }
      }
    });

    const backBtn = Button({
      label: t('onboarding.backStep'),
      variant: 'quiet',
      fullWidth: true,
      onClick: () => {
        currentStep = 1;
        stepError = '';
        render();
      }
    });

    return h('div', { className: 'onboarding-step' },
      h('h2', { className: 'heading-display mb-2' }, t('onboarding.stepWorker2')),
      h('p', { className: 'body-text mb-4' }, t('onboarding.rateHint')),
      hourlyField,
      dailyField,
      compassNode,
      nextBtn,
      h('div', { className: 'mt-2' }),
      backBtn
    );
  }

  // --- Step 3: Worker Area ---
  function renderWorkerStep3() {
    updateHeader();

    const locPicker = LocalityPicker({
      value: localityKey,
      localities: meta.localities || [],
      onSelectLocality: (key) => {
        localityKey = key;
        stepError = '';
      },
      onCoordsResolved: async (coords) => {
        try {
          isSaving = true;
          render();
          const updated = await api.updateMe({ location: coords });
          const updatedUser = updated.user || updated;
          setState({ user: updatedUser });
          if (updatedUser.localityKey) {
            localityKey = updatedUser.localityKey;
            locPicker.setValue(localityKey);
          }
          isSaving = false;
          render();
        } catch (err) {
          isSaving = false;
          stepError = err.message || t('error.unknown');
          render();
        }
      }
    });

    const rangeField = RangeField({
      value: radiusKm,
      onChange: (km) => {
        radiusKm = km;
      }
    });

    const nextBtn = Button({
      label: isSaving ? t('onboarding.saving') : t('onboarding.nextStep'),
      variant: 'primary',
      fullWidth: true,
      isBusy: isSaving,
      disabled: isSaving,
      onClick: async () => {
        if (!localityKey) {
          stepError = t('onboarding.areaError');
          render();
          return;
        }

        isSaving = true;
        render();

        try {
          const updated = await api.updateMe({
            localityKey,
            radiusKm
          });
          const updatedUser = updated.user || updated;
          setState({ user: updatedUser });
          currentStep = 4;
          isSaving = false;
          stepError = '';
          render();
        } catch (err) {
          isSaving = false;
          stepError = err.message || t('error.unknown');
          render();
        }
      }
    });

    const backBtn = Button({
      label: t('onboarding.backStep'),
      variant: 'quiet',
      fullWidth: true,
      onClick: () => {
        currentStep = 2;
        stepError = '';
        render();
      }
    });

    return h('div', { className: 'onboarding-step' },
      h('h2', { className: 'heading-display mb-2' }, t('onboarding.stepWorker3')),
      h('p', { className: 'body-text mb-4' }, t('onboarding.areaHint')),
      locPicker.element,
      rangeField.element,
      h('div', { className: 'mt-4' }),
      nextBtn,
      h('div', { className: 'mt-2' }),
      backBtn
    );
  }

  // --- Step 4: Worker About You & Review Sheet ---
  function renderWorkerStep4() {
    updateHeader();

    const charCounter = h('div', { className: 'field-hint text-right' },
      t('onboarding.bioCharCount', { count: bio.length })
    );

    const bioInput = h('textarea', {
      id: 'worker-bio',
      className: 'field-textarea',
      rows: 3,
      maxLength: 200,
      placeholder: t('onboarding.bioPlaceholder'),
      value: bio,
      onInput: (e) => {
        bio = e.target.value;
        charCounter.textContent = t('onboarding.bioCharCount', { count: bio.length });
        stepError = '';
      }
    });

    const bioGroup = h('div', { className: 'field-group' },
      h('label', { for: 'worker-bio', className: 'field-label' }, t('onboarding.bioLabel')),
      bioInput,
      charCounter
    );

    // Photo upload control
    const photoPreviewImgProps = {
      alt: 'Profile preview',
      className: 'avatar-preview-img',
      hidden: !photoUrl
    };
    if (photoUrl) {
      photoPreviewImgProps.src = photoUrl;
    }
    const photoPreviewImg = h('img', photoPreviewImgProps);

    const fileInput = h('input', {
      type: 'file',
      accept: 'image/jpeg,image/png,image/webp',
      className: 'visually-hidden',
      onChange: async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
          uploadStatusText = 'Processing image…';
          render();

          const uploadedUrl = await processAndUploadAvatar(file, (msg) => {
            uploadStatusText = msg;
            render();
          });

          photoUrl = uploadedUrl;
          await api.updateMe({ photoUrl });
          uploadStatusText = '';
          render();
        } catch (uploadErr) {
          uploadStatusText = '';
          if (uploadErr.code === 'UPLOADS_DISABLED') {
            uploadDisabled = true;
          } else {
            stepError = uploadErr.message;
          }
          render();
        }
      }
    });

    const choosePhotoBtn = Button({
      label: t('onboarding.photoChoose'),
      variant: 'secondary',
      onClick: () => fileInput.click()
    });

    const removePhotoBtn = photoUrl ? Button({
      label: t('onboarding.photoRemove'),
      variant: 'quiet',
      onClick: async () => {
        photoUrl = '';
        await api.updateMe({ photoUrl: '' });
        render();
      }
    }) : null;

    const photoControls = uploadDisabled ? h('p', { className: 'field-hint font-italic' }, t('onboarding.photoDisabled')) : h('div', { className: 'photo-controls' },
      photoPreviewImg,
      choosePhotoBtn,
      removePhotoBtn,
      uploadStatusText ? h('p', { className: 'field-hint mt-2' }, uploadStatusText) : null,
      fileInput
    );

    const finishBtn = Button({
      label: isSaving ? t('onboarding.saving') : t('onboarding.finish'),
      variant: 'primary',
      fullWidth: true,
      isBusy: isSaving,
      disabled: isSaving,
      onClick: async () => {
        // Validate contact info in bio
        if (bio && containsContactInfo(bio)) {
          stepError = t('onboarding.bioContactWarning');
          render();
          return;
        }

        isSaving = true;
        render();

        try {
          const updated = await api.updateMe({ bio: bio.trim() });
          const updatedUser = updated.user || updated;
          setState({ user: updatedUser });

          if (updatedUser.profileComplete) {
            showToast('Profile completed successfully!', 'success');
            navigate('/app/home');
          } else {
            showToast('Profile saved.', 'info');
            navigate('/app/home');
          }
        } catch (err) {
          isSaving = false;
          stepError = err.message || t('error.unknown');
          render();
        }
      }
    });

    const backBtn = Button({
      label: t('onboarding.backStep'),
      variant: 'quiet',
      fullWidth: true,
      onClick: () => {
        currentStep = 3;
        stepError = '';
        render();
      }
    });

    return h('div', { className: 'onboarding-step' },
      h('h2', { className: 'heading-display mb-2' }, t('onboarding.stepWorker4')),
      h('p', { className: 'body-text mb-4' }, t('onboarding.aboutHint')),
      h('div', { className: 'field-group mb-4' },
        h('label', { className: 'field-label' }, t('onboarding.photoLabel')),
        photoControls
      ),
      bioGroup,
      finishBtn,
      h('div', { className: 'mt-2' }),
      backBtn
    );
  }

  // --- Customer Single-Screen Onboarding ---
  function renderCustomerOnboarding() {
    updateHeader();

    const nameField = Field({
      id: 'customer-name',
      label: t('auth.nameLabel'),
      value: customerName,
      readOnly: Boolean(user.name),
      onInput: (e) => {
        customerName = e.target.value;
      }
    });

    const phoneField = Field({
      id: 'customer-phone',
      label: t('auth.phoneLabel'),
      value: customerPhone,
      prefix: t('auth.phonePrefix'),
      readOnly: Boolean(user.phone),
      onInput: (e) => {
        customerPhone = e.target.value;
      }
    });

    const locPicker = LocalityPicker({
      value: localityKey,
      localities: meta.localities || [],
      onSelectLocality: (key) => {
        localityKey = key;
        stepError = '';
      },
      onCoordsResolved: async (coords) => {
        try {
          isSaving = true;
          render();
          const updated = await api.updateMe({ location: coords });
          const updatedUser = updated.user || updated;
          setState({ user: updatedUser });
          if (updatedUser.localityKey) {
            localityKey = updatedUser.localityKey;
            locPicker.setValue(localityKey);
          }
          isSaving = false;
          render();
        } catch (err) {
          isSaving = false;
          stepError = err.message || t('error.unknown');
          render();
        }
      }
    });

    const finishBtn = Button({
      label: isSaving ? t('onboarding.saving') : t('onboarding.finish'),
      variant: 'primary',
      fullWidth: true,
      isBusy: isSaving,
      disabled: isSaving,
      onClick: async () => {
        if (!localityKey) {
          stepError = t('onboarding.areaError');
          render();
          return;
        }

        isSaving = true;
        render();

        try {
          const updated = await api.updateMe({ localityKey });
          const updatedUser = updated.user || updated;
          setState({ user: updatedUser });
          showToast('Profile completed successfully!', 'success');
          navigate('/app/find');
        } catch (err) {
          isSaving = false;
          stepError = err.message || t('error.unknown');
          render();
        }
      }
    });

    return h('div', { className: 'onboarding-step' },
      h('h2', { className: 'heading-display mb-2' }, t('onboarding.stepCustomer1')),
      nameField,
      phoneField,
      LedgerRule(),
      h('h2', { className: 'heading-display mb-2' }, t('onboarding.stepCustomer2')),
      locPicker.element,
      finishBtn
    );
  }

  function render() {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }

    if (stepError) {
      container.appendChild(h('div', {
        className: 'field-error card mb-3',
        role: 'alert'
      }, stepError));
    }

    const stepContent = isWorker
      ? (currentStep === 1 ? renderWorkerStep1()
       : currentStep === 2 ? renderWorkerStep2()
       : currentStep === 3 ? renderWorkerStep3()
       : renderWorkerStep4())
      : renderCustomerOnboarding();

    container.appendChild(stepContent);
  }

  render();
  return container;
}
