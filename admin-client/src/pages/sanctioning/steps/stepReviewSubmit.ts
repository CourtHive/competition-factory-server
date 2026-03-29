import { createSanctioningRecord, executeSanctioningMethod } from 'services/apis/sanctioningApi';
import { createStatusBadge } from '../components/statusBadge';
import { tmxToast } from 'services/notifications/tmxToast';
import { context } from 'services/context';

import { SANCTIONING } from 'constants/tmxConstants';

export function renderReviewStep(container: HTMLElement, wizardState: any): void {
  const { formData, sanctioningId } = wizardState;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'max-width: 800px;';

  const title = document.createElement('h3');
  title.textContent = 'Review Application';
  title.style.cssText = 'margin: 0 0 16px; font-size: 1em; font-weight: 600;';
  wrapper.appendChild(title);

  // Summary sections
  const sections = [
    {
      label: 'Tournament',
      items: [
        ['Name', formData.tournamentName],
        ['Dates', `${formData.proposedStartDate || '—'} to ${formData.proposedEndDate || '—'}`],
        ['Country', formData.hostCountryCode || '—'],
        ['Surface', formData.surfaceCategory || '—'],
        ['Indoor/Outdoor', formData.indoorOutdoor || '—'],
        ['Level', formData.sanctioningLevel || '—'],
        ['Governing Body', formData.governingBodyId || '—'],
      ],
    },
    {
      label: 'Applicant',
      items: [
        ['Organisation', formData.applicant?.organisationName || '—'],
        ['Contact', formData.applicant?.contactName || '—'],
        ['Email', formData.applicant?.contactEmail || '—'],
      ],
    },
  ];

  for (const section of sections) {
    const sectionEl = document.createElement('div');
    sectionEl.style.cssText = 'margin-bottom: 20px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 8px; overflow: hidden;';

    const sectionHeader = document.createElement('div');
    sectionHeader.textContent = section.label;
    sectionHeader.style.cssText = 'padding: 8px 12px; background: var(--tmx-bg-secondary, #f5f5f5); font-weight: 600; font-size: 0.9em; border-bottom: 1px solid var(--tmx-border-primary, #ddd);';
    sectionEl.appendChild(sectionHeader);

    const grid = document.createElement('div');
    grid.style.cssText = 'display: grid; grid-template-columns: 140px 1fr; padding: 4px 0;';

    for (const [key, val] of section.items) {
      const keyEl = document.createElement('div');
      keyEl.textContent = key;
      keyEl.style.cssText = 'padding: 4px 12px; font-size: 0.85em; color: var(--tmx-text-secondary, #666); font-weight: 500;';
      const valEl = document.createElement('div');
      valEl.textContent = val as string;
      valEl.style.cssText = 'padding: 4px 12px; font-size: 0.85em;';
      if (!val || val === '—') valEl.style.color = 'var(--tmx-accent-red, #ff6b6b)';
      grid.appendChild(keyEl);
      grid.appendChild(valEl);
    }

    sectionEl.appendChild(grid);
    wrapper.appendChild(sectionEl);
  }

  // Events section
  const eventsSection = document.createElement('div');
  eventsSection.style.cssText = 'margin-bottom: 20px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 8px; overflow: hidden;';

  const eventsHeader = document.createElement('div');
  eventsHeader.textContent = `Events (${formData.events?.length || 0})`;
  eventsHeader.style.cssText = 'padding: 8px 12px; background: var(--tmx-bg-secondary, #f5f5f5); font-weight: 600; font-size: 0.9em; border-bottom: 1px solid var(--tmx-border-primary, #ddd);';
  eventsSection.appendChild(eventsHeader);

  if (formData.events?.length) {
    for (const event of formData.events) {
      const eventRow = document.createElement('div');
      eventRow.style.cssText = 'padding: 8px 12px; border-bottom: 1px solid var(--tmx-border-secondary, #eee); font-size: 0.85em;';
      eventRow.textContent = `${event.eventName} — ${event.eventType} ${event.gender ? `(${event.gender})` : ''} ${event.drawSize ? `Draw: ${event.drawSize}` : ''}`;
      eventsSection.appendChild(eventRow);
    }
  } else {
    const noEvents = document.createElement('div');
    noEvents.textContent = 'No events added';
    noEvents.style.cssText = 'padding: 12px; color: var(--tmx-accent-red, #ff6b6b); font-size: 0.85em;';
    eventsSection.appendChild(noEvents);
  }
  wrapper.appendChild(eventsSection);

  // Validation warnings
  const warnings: string[] = [];
  if (!formData.tournamentName) warnings.push('Tournament name is required');
  if (!formData.proposedStartDate) warnings.push('Start date is required');
  if (!formData.proposedEndDate) warnings.push('End date is required');
  if (!formData.events?.length) warnings.push('At least one event is required');
  if (!formData.governingBodyId) warnings.push('Governing body is required');
  if (!formData.applicant?.organisationName) warnings.push('Applicant organisation is required');

  if (warnings.length) {
    const warningBox = document.createElement('div');
    warningBox.style.cssText = 'padding: 12px; border-radius: 8px; background: #fff3cd; border: 1px solid #ffc107; margin-bottom: 16px;';
    const warningTitle = document.createElement('div');
    warningTitle.textContent = 'Missing Required Fields';
    warningTitle.style.cssText = 'font-weight: 600; margin-bottom: 8px; font-size: 0.9em;';
    warningBox.appendChild(warningTitle);

    for (const w of warnings) {
      const wEl = document.createElement('div');
      wEl.textContent = `• ${w}`;
      wEl.style.cssText = 'font-size: 0.85em; padding: 2px 0;';
      warningBox.appendChild(wEl);
    }
    wrapper.appendChild(warningBox);
  }

  // Action buttons
  const actions = document.createElement('div');
  actions.style.cssText = 'display: flex; gap: 12px; margin-top: 16px;';

  const saveDraftBtn = document.createElement('button');
  saveDraftBtn.textContent = 'Save as Draft';
  saveDraftBtn.style.cssText = 'padding: 10px 20px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 4px; cursor: pointer; background: transparent; font-weight: 500;';
  saveDraftBtn.addEventListener('click', () => handleSaveDraft(formData, sanctioningId));
  actions.appendChild(saveDraftBtn);

  if (!warnings.length) {
    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Save & Submit Application';
    submitBtn.className = 'btn-invite';
    submitBtn.style.cssText = 'padding: 10px 20px; border: none; border-radius: 4px; cursor: pointer; color: #fff; font-weight: 500;';
    submitBtn.addEventListener('click', () => handleSubmit(formData, sanctioningId));
    actions.appendChild(submitBtn);
  }

  wrapper.appendChild(actions);
  container.appendChild(wrapper);
}

async function handleSaveDraft(formData: any, sanctioningId?: string) {
  try {
    if (sanctioningId) {
      await executeSanctioningMethod({
        sanctioningId,
        method: 'updateProposal',
        params: { updates: formData },
      });
      tmxToast({ message: 'Draft saved', intent: 'is-success' });
    } else {
      const response: any = await createSanctioningRecord({
        governingBodyId: formData.governingBodyId || 'default',
        applicant: formData.applicant,
        proposal: {
          tournamentName: formData.tournamentName,
          proposedStartDate: formData.proposedStartDate,
          proposedEndDate: formData.proposedEndDate,
          hostCountryCode: formData.hostCountryCode,
          surfaceCategory: formData.surfaceCategory,
          indoorOutdoor: formData.indoorOutdoor,
          events: formData.events || [],
        },
        sanctioningLevel: formData.sanctioningLevel,
      });
      if (response?.data?.success) {
        tmxToast({ message: 'Draft created', intent: 'is-success' });
        context.router?.navigate(`/${SANCTIONING}`);
      }
    }
  } catch {
    tmxToast({ message: 'Failed to save draft', intent: 'is-danger' });
  }
}

async function handleSubmit(formData: any, sanctioningId?: string) {
  try {
    if (!sanctioningId) {
      await handleSaveDraft(formData);
      return;
    }
    await executeSanctioningMethod({
      sanctioningId,
      method: 'submitApplication',
      params: {},
    });
    tmxToast({ message: 'Application submitted', intent: 'is-success' });
    context.router?.navigate(`/${SANCTIONING}`);
  } catch {
    tmxToast({ message: 'Failed to submit application', intent: 'is-danger' });
  }
}
