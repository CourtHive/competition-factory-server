import { updateWizardFormData, getWizardState } from '../renderSanctioningWizard';
import { openModal } from 'components/modals/baseModal/baseModal';

export function renderEventsStep(container: HTMLElement, wizardState: any): void {
  const { formData } = wizardState;

  const wrapper = document.createElement('div');

  const header = document.createElement('div');
  header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;';

  const title = document.createElement('h3');
  title.textContent = 'Event Proposals';
  title.style.cssText = 'margin: 0; font-size: 1em; font-weight: 600;';

  const addBtn = document.createElement('button');
  addBtn.textContent = '+ Add Event';
  addBtn.className = 'btn-invite';
  addBtn.style.cssText =
    'padding: 6px 14px; border: none; border-radius: 4px; cursor: pointer; color: #fff; font-size: 0.85em;';
  addBtn.addEventListener('click', () => openEventModal(formData, container));

  header.appendChild(title);
  header.appendChild(addBtn);
  wrapper.appendChild(header);

  // Events list
  if (formData.events?.length) {
    const table = document.createElement('table');
    table.style.cssText = 'width: 100%; border-collapse: collapse; max-width: 900px;';

    const thead = document.createElement('thead');
    thead.innerHTML = `<tr style="border-bottom: 2px solid var(--tmx-border-primary, #ddd); text-align: left;">
      <th style="padding: 8px; font-size: 0.85em; font-weight: 600;">Event Name</th>
      <th style="padding: 8px; font-size: 0.85em; font-weight: 600;">Type</th>
      <th style="padding: 8px; font-size: 0.85em; font-weight: 600;">Gender</th>
      <th style="padding: 8px; font-size: 0.85em; font-weight: 600;">Draw Size</th>
      <th style="padding: 8px; font-size: 0.85em; font-weight: 600;">Draw Type</th>
      <th style="padding: 8px; font-size: 0.85em; font-weight: 600;">Format</th>
      <th style="padding: 8px; font-size: 0.85em; font-weight: 600;"></th>
    </tr>`;
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let i = 0; i < formData.events.length; i++) {
      const event = formData.events[i];
      const tr = document.createElement('tr');
      tr.style.cssText = 'border-bottom: 1px solid var(--tmx-border-secondary, #eee);';
      tr.innerHTML = `
        <td style="padding: 8px; font-size: 0.9em;">${event.eventName || ''}</td>
        <td style="padding: 8px; font-size: 0.9em;">${event.eventType || ''}</td>
        <td style="padding: 8px; font-size: 0.9em;">${event.gender || ''}</td>
        <td style="padding: 8px; font-size: 0.9em;">${event.drawSize || ''}</td>
        <td style="padding: 8px; font-size: 0.9em;">${event.drawType || ''}</td>
        <td style="padding: 8px; font-size: 0.9em;">${event.matchUpFormat || ''}</td>
        <td style="padding: 8px;"></td>
      `;

      const removeBtn = document.createElement('button');
      removeBtn.textContent = 'Remove';
      removeBtn.className = 'btn-remove';
      removeBtn.style.cssText =
        'padding: 4px 10px; border: none; border-radius: 4px; cursor: pointer; color: #fff; font-size: 0.8em;';
      removeBtn.addEventListener('click', () => {
        formData.events.splice(i, 1);
        updateWizardFormData({ events: formData.events });
        renderEventsStep(container, getWizardState());
      });

      tr.querySelector('td:last-child').appendChild(removeBtn);
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
  } else {
    const empty = document.createElement('div');
    empty.textContent = 'No events added yet. Click "+ Add Event" to begin.';
    empty.style.cssText =
      'padding: 24px; text-align: center; color: var(--tmx-text-tertiary, #999); border: 2px dashed var(--tmx-border-primary, #ddd); border-radius: 8px;';
    wrapper.appendChild(empty);
  }

  container.appendChild(wrapper);
}

function openEventModal(formData: any, parentContainer: HTMLElement) {
  const fields: Record<string, HTMLInputElement | HTMLSelectElement> = {};

  const content = document.createElement('div');
  content.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; min-width: 400px;';

  const defs = [
    { key: 'eventName', label: 'Event Name', type: 'text', fullWidth: true },
    { key: 'eventType', label: 'Event Type', type: 'select', options: ['SINGLES', 'DOUBLES', 'TEAM'] },
    { key: 'gender', label: 'Gender', type: 'select', options: ['', 'MALE', 'FEMALE', 'MIXED', 'ANY'] },
    { key: 'drawSize', label: 'Draw Size', type: 'number' },
    {
      key: 'drawType',
      label: 'Draw Type',
      type: 'select',
      options: ['', 'SINGLE_ELIMINATION', 'ROUND_ROBIN', 'FEED_IN_CHAMPIONSHIP', 'COMPASS'],
    },
    { key: 'matchUpFormat', label: 'Match Format', type: 'text', placeholder: 'e.g., SET3-S:6/TB7' },
  ];

  for (const def of defs) {
    const wrapper = document.createElement('div');
    if (def.fullWidth) wrapper.style.gridColumn = '1 / -1';

    const label = document.createElement('label');
    label.textContent = def.label;
    label.style.cssText = 'display: block; font-size: 0.85em; margin-bottom: 4px;';

    let input: HTMLInputElement | HTMLSelectElement;
    if (def.type === 'select' && def.options) {
      input = document.createElement('select');
      for (const opt of def.options) {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt || '— Select —';
        input.appendChild(option);
      }
    } else {
      input = document.createElement('input');
      input.type = def.type || 'text';
      if (def.placeholder) input.placeholder = def.placeholder;
    }
    input.style.cssText =
      'width: 100%; padding: 6px; border: 1px solid var(--tmx-border-primary, #ddd); border-radius: 4px; box-sizing: border-box;';

    fields[def.key] = input;
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    content.appendChild(wrapper);
  }

  openModal({
    title: 'Add Event Proposal',
    content,
    buttons: [
      {
        label: 'Add',
        intent: 'is-primary',
        close: true,
        onClick: () => {
          const newEvent: any = {};
          for (const [key, input] of Object.entries(fields)) {
            const val = input.value;
            if (val) newEvent[key] = key === 'drawSize' ? Number.parseInt(val, 10) : val;
          }
          if (!newEvent.eventName || !newEvent.eventType) return;

          formData.events ??= [];
          formData.events.push(newEvent);
          updateWizardFormData({ events: formData.events });

          // Re-render events step
          const container = parentContainer;
          while (container.firstChild) container.firstChild.remove();
          renderEventsStep(container, getWizardState());
        },
      },
      { label: 'Cancel', close: true },
    ],
  });
}
