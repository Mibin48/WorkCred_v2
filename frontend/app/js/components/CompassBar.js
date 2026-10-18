import { h } from '../utils/dom.js';
import { SampleDataLabel } from './SampleDataLabel.js';
import { t } from '../i18n/strings.en.js';

export function CompassBar({
  p25 = 100,
  median = 150,
  p75 = 200,
  userRate = null,
  skill = 'Work',
  area = 'Kochi',
  isSample = false
}) {
  const minVal = Math.min(p25 * 0.7, (userRate || p25) * 0.7);
  const maxVal = Math.max(p75 * 1.3, (userRate || p75) * 1.3);
  const range = maxVal - minVal || 1;

  function toPercent(val) {
    const clamped = Math.max(minVal, Math.min(maxVal, val));
    return Math.round(((clamped - minVal) / range) * 100);
  }

  const p25Pct = toPercent(p25);
  const p75Pct = toPercent(p75);
  const medianPct = toPercent(median);
  const userPct = userRate ? toPercent(userRate) : null;

  // We use data-* attributes for positions to satisfy CSP without inline style
  const bandEl = h('div', {
    className: 'compass-band',
    'data-left': String(p25Pct),
    'data-width': String(p75Pct - p25Pct)
  });

  const medianTickEl = h('div', {
    className: 'compass-median-tick',
    'data-left': String(medianPct)
  });

  const track = h('div', { className: 'compass-bar-track' }, bandEl, medianTickEl);

  if (userPct !== null) {
    const markerEl = h('div', {
      className: 'compass-marker',
      'data-left': String(userPct),
      title: `Your rate: ₹${userRate}/hr`
    });
    track.appendChild(markerEl);
  }

  const captionText = t('onboarding.compassCaption', {
    skill,
    area,
    p25,
    p75,
    median
  });

  const header = h('div', { className: 'compass-header' },
    h('span', { className: 'field-label' }, t('onboarding.compassTitle')),
    isSample ? SampleDataLabel() : null
  );

  const caption = h('div', { className: 'compass-caption' },
    h('p', null, captionText),
    isSample ? h('small', { className: 'text-small font-italic' }, t('onboarding.compassSampleNote')) : null
  );

  return h('div', { className: 'compass-container' }, header, track, caption);
}
