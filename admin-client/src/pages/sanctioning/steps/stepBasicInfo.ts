import { updateWizardFormData } from '../renderSanctioningWizard';

export function renderBasicInfoStep(container: HTMLElement, wizardState: any): void {
  const { formData } = wizardState;

  const form = document.createElement('div');
  form.setAttribute('role', 'form');
  form.setAttribute('aria-label', 'Tournament basic information');
  form.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 16px; max-width: 800px;';

  const fields = [
    { key: 'tournamentName', label: 'Tournament Name', type: 'text', required: true, fullWidth: true },
    { key: 'proposedStartDate', label: 'Start Date', type: 'date', required: true },
    { key: 'proposedEndDate', label: 'End Date', type: 'date', required: true },
    { key: 'hostCountryCode', label: 'Country Code', type: 'text', placeholder: 'e.g., USA' },
    { key: 'sanctioningLevel', label: 'Sanctioning Level/Tier', type: 'text', placeholder: 'e.g., W50, Level 3' },
    {
      key: 'surfaceCategory',
      label: 'Surface',
      type: 'select',
      options: ['', 'HARD', 'CLAY', 'GRASS', 'CARPET', 'ARTIFICIAL'],
    },
    {
      key: 'indoorOutdoor',
      label: 'Indoor/Outdoor',
      type: 'select',
      options: ['', 'INDOOR', 'OUTDOOR', 'MIXED'],
    },
    { key: 'governingBodyId', label: 'Governing Body ID', type: 'text', placeholder: 'e.g., itf, usta' },
  ];

  const sectionTitle = document.createElement('h3');
  sectionTitle.textContent = 'Tournament Details';
  sectionTitle.style.cssText = 'grid-column: 1 / -1; margin: 0 0 4px; font-size: 1em; font-weight: 600; color: var(--tmx-text-primary);';
  form.appendChild(sectionTitle);

  for (const field of fields) {
    const wrapper = document.createElement('div');
    if (field.fullWidth) wrapper.style.gridColumn = '1 / -1';

    const label = document.createElement('label');
    label.textContent = field.label + (field.required ? ' *' : '');
    label.style.cssText = 'display: block; font-size: 0.85em; font-weight: 500; margin-bottom: 4px; color: var(--tmx-text-secondary, #666);';

    let input: HTMLInputElement | HTMLSelectElement;
    if (field.type === 'select' && field.options) {
      input = document.createElement('select');
      for (const opt of field.options) {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt || '— Select —';
        option.selected = formData[field.key] === opt;
        input.appendChild(option);
      }
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
      input.value = formData[field.key] || '';
      if (field.placeholder) input.placeholder = field.placeholder;
    }

    input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 4px; font-size: 0.9em; box-sizing: border-box;';

    input.addEventListener('change', (e) => {
      updateWizardFormData({ [field.key]: (e.target as any).value });
    });

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  }

  // Applicant section
  const applicantTitle = document.createElement('h3');
  applicantTitle.textContent = 'Applicant Information';
  applicantTitle.style.cssText = 'grid-column: 1 / -1; margin: 16px 0 4px; font-size: 1em; font-weight: 600; color: var(--tmx-text-primary);';
  form.appendChild(applicantTitle);

  const applicantFields = [
    { key: 'organisationName', label: 'Organisation Name', required: true },
    { key: 'contactName', label: 'Contact Name', required: true },
    { key: 'contactEmail', label: 'Contact Email', type: 'email' },
  ];

  for (const field of applicantFields) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.textContent = field.label + (field.required ? ' *' : '');
    label.style.cssText = 'display: block; font-size: 0.85em; font-weight: 500; margin-bottom: 4px; color: var(--tmx-text-secondary, #666);';

    const input = document.createElement('input');
    input.type = field.type || 'text';
    input.value = formData.applicant?.[field.key] || '';
    input.style.cssText = 'width: 100%; padding: 8px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 4px; font-size: 0.9em; box-sizing: border-box;';

    input.addEventListener('change', (e) => {
      if (!formData.applicant) formData.applicant = {};
      formData.applicant[field.key] = (e.target as any).value;
      updateWizardFormData({ applicant: formData.applicant });
    });

    wrapper.appendChild(label);
    wrapper.appendChild(input);
    form.appendChild(wrapper);
  }

  container.appendChild(form);
}
