import { showTMXsanctioning } from 'services/transitions/screenSlaver';
import { removeAllChildNodes } from 'services/dom/transformers';
import { renderBasicInfoStep } from './steps/stepBasicInfo';
import { renderEventsStep } from './steps/stepEvents';
import { renderReviewStep } from './steps/stepReviewSubmit';
import { tmxToast } from 'services/notifications/tmxToast';
import { context } from 'services/context';

function validateCurrentStep(state: WizardState): string | undefined {
  const { currentStep, formData } = state;

  if (currentStep === 0) {
    if (!formData.tournamentName?.trim()) return 'Tournament name is required';
    if (!formData.proposedStartDate) return 'Start date is required';
    if (!formData.proposedEndDate) return 'End date is required';
    if (formData.proposedStartDate > formData.proposedEndDate) return 'End date must be after start date';
    if (!formData.governingBodyId?.trim()) return 'Governing body is required';
    if (!formData.applicant?.organisationName?.trim()) return 'Applicant organisation is required';
  }

  if (currentStep === 1) {
    if (!formData.events?.length) return 'At least one event is required';
    for (const event of formData.events) {
      if (!event.eventName?.trim()) return 'All events must have a name';
      if (!event.eventType) return 'All events must have a type';
    }
  }

  return undefined;
}

import { TMX_SANCTIONING, SANCTIONING } from 'constants/tmxConstants';

const STEPS = [
  { label: 'Basic Info', render: renderBasicInfoStep },
  { label: 'Events', render: renderEventsStep },
  { label: 'Review & Submit', render: renderReviewStep },
];

type WizardState = {
  currentStep: number;
  formData: any;
  sanctioningId?: string;
};

let wizardState: WizardState = {
  currentStep: 0,
  formData: {
    tournamentName: '',
    proposedStartDate: '',
    proposedEndDate: '',
    hostCountryCode: '',
    surfaceCategory: '',
    indoorOutdoor: '',
    sanctioningLevel: '',
    governingBodyId: '',
    events: [],
    applicant: {
      organisationName: '',
      contactName: '',
      contactEmail: '',
    },
  },
};

export function getWizardState(): WizardState {
  return wizardState;
}

export function updateWizardFormData(updates: any) {
  Object.assign(wizardState.formData, updates);
}

export function renderSanctioningWizard(sanctioningId?: string): void {
  showTMXsanctioning();

  // Reset wizard state for new applications
  if (!sanctioningId) {
    wizardState = {
      currentStep: 0,
      formData: {
        tournamentName: '',
        proposedStartDate: '',
        proposedEndDate: '',
        hostCountryCode: '',
        surfaceCategory: '',
        indoorOutdoor: '',
        sanctioningLevel: '',
        governingBodyId: '',
        events: [],
        applicant: {
          organisationName: '',
          contactName: '',
          contactEmail: '',
        },
      },
    };
  } else {
    wizardState.sanctioningId = sanctioningId;
  }

  renderCurrentStep();
}

function renderCurrentStep() {
  const container = document.getElementById(TMX_SANCTIONING);
  if (!container) return;
  removeAllChildNodes(container);

  // Wizard chrome
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display: flex; flex-direction: column; height: 100%; padding: 16px 20px;';

  // Step indicators
  const stepBar = document.createElement('div');
  stepBar.style.cssText = 'display: flex; gap: 4px; margin-bottom: 20px; align-items: center;';

  for (let i = 0; i < STEPS.length; i++) {
    const stepIndicator = document.createElement('div');
    stepIndicator.style.cssText = `
      display: flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 20px; font-size: 0.85em; cursor: pointer;
      ${i === wizardState.currentStep
        ? 'background: var(--tmx-accent-blue, #4a90d9); color: #fff; font-weight: 600;'
        : i < wizardState.currentStep
          ? 'background: var(--tmx-accent-green, #48c774); color: #fff;'
          : 'background: var(--tmx-bg-tertiary, #e0e0e0); color: var(--tmx-text-secondary, #666);'
      }
    `;

    const num = document.createElement('span');
    num.textContent = `${i + 1}`;
    num.style.cssText = 'width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 0.8em;';

    const label = document.createElement('span');
    label.textContent = STEPS[i].label;

    stepIndicator.appendChild(num);
    stepIndicator.appendChild(label);
    stepIndicator.addEventListener('click', () => {
      if (i <= wizardState.currentStep) {
        wizardState.currentStep = i;
        renderCurrentStep();
      }
    });
    stepBar.appendChild(stepIndicator);

    if (i < STEPS.length - 1) {
      const separator = document.createElement('div');
      separator.style.cssText = 'width: 20px; height: 2px; background: var(--tmx-border-primary, #ddd);';
      stepBar.appendChild(separator);
    }
  }

  wrapper.appendChild(stepBar);

  // Step content area
  const contentArea = document.createElement('div');
  contentArea.style.cssText = 'flex: 1; min-height: 0; overflow-y: auto;';
  wrapper.appendChild(contentArea);

  // Navigation buttons
  const navBar = document.createElement('div');
  navBar.style.cssText = 'display: flex; justify-content: space-between; padding-top: 16px; border-top: 1px solid var(--tmx-border-primary, #ddd); margin-top: 16px;';

  const leftButtons = document.createElement('div');
  const rightButtons = document.createElement('div');
  rightButtons.style.cssText = 'display: flex; gap: 8px;';

  // Cancel button
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.style.cssText = 'padding: 8px 16px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 4px; cursor: pointer; background: transparent; color: var(--tmx-text-primary);';
  cancelBtn.addEventListener('click', () => context.router?.navigate(`/${SANCTIONING}`));
  leftButtons.appendChild(cancelBtn);

  // Back button
  if (wizardState.currentStep > 0) {
    const backBtn = document.createElement('button');
    backBtn.textContent = 'Back';
    backBtn.style.cssText = 'padding: 8px 16px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 4px; cursor: pointer; background: transparent; color: var(--tmx-text-primary);';
    backBtn.addEventListener('click', () => {
      wizardState.currentStep--;
      renderCurrentStep();
    });
    rightButtons.appendChild(backBtn);
  }

  // Next / Submit button
  if (wizardState.currentStep < STEPS.length - 1) {
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next';
    nextBtn.className = 'btn-edit';
    nextBtn.setAttribute('aria-label', 'Next step');
    nextBtn.style.cssText = 'padding: 8px 20px; border: none; border-radius: 4px; cursor: pointer; color: #fff; font-weight: 500;';
    nextBtn.addEventListener('click', () => {
      const validationError = validateCurrentStep(wizardState);
      if (validationError) {
        tmxToast({ message: validationError, intent: 'is-warning' });
        return;
      }
      wizardState.currentStep++;
      renderCurrentStep();
    });
    rightButtons.appendChild(nextBtn);
  }

  navBar.appendChild(leftButtons);
  navBar.appendChild(rightButtons);
  wrapper.appendChild(navBar);

  container.appendChild(wrapper);

  // Render step content
  STEPS[wizardState.currentStep].render(contentArea, wizardState);
}
