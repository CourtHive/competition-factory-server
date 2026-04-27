/**
 * Shared helpers for the provider-config editor modals (caps + settings).
 *
 * Both editors render the same shape of fields; the differences are
 * which sections appear and whether settings fields are cap-aware
 * (disabled with a "locked by provisioner" tooltip when a cap forbids).
 */
import type { ValidationIssue } from 'types/providerConfig';

const CHECKBOX_ROW =
  'display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; padding: 4px 0;';
const SECTION_HEADER =
  'margin: 12px 0 6px; font-size: .85rem; font-weight: 600; color: var(--tmx-text-secondary, #555);';
const FIELD_LABEL = 'display: block; font-size: .8rem; color: var(--tmx-text-secondary, #555); margin-bottom: 2px;';
const TEXT_INPUT =
  'width: 100%; padding: 4px 8px; border: 1px solid var(--tmx-border-primary, #ccc); border-radius: 4px; font-size: .85rem; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636);';
const ISSUE_LINE =
  'color: var(--tmx-text-error, #d33); font-size: .75rem; margin-top: 2px;';

export function buildSectionHeader(text: string): HTMLElement {
  const h = document.createElement('div');
  h.style.cssText = SECTION_HEADER;
  h.textContent = text;
  return h;
}

export interface CheckboxFieldOptions {
  label: string;
  checked: boolean;
  /** When true, the field is non-editable and shows a tooltip explaining why. */
  pinned?: boolean;
  pinnedReason?: string;
  /** Where the input element is exposed for value reads on save. */
  registry: Record<string, () => boolean>;
  registryKey: string;
}

export function buildCheckboxField(opts: CheckboxFieldOptions): HTMLElement {
  const row = document.createElement('label');
  row.style.cssText = CHECKBOX_ROW;
  if (opts.pinned) row.style.opacity = '0.55';

  const labelText = document.createElement('span');
  labelText.style.cssText = 'font-size: .85rem;';
  labelText.textContent = opts.label;
  row.appendChild(labelText);

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = opts.checked;
  if (opts.pinned) {
    cb.disabled = true;
    if (opts.pinnedReason) row.title = opts.pinnedReason;
  }
  row.appendChild(cb);

  opts.registry[opts.registryKey] = () => cb.checked;
  return row;
}

export interface TextFieldOptions {
  label: string;
  value: string;
  placeholder?: string;
  registry: Record<string, () => string>;
  registryKey: string;
}

export function buildTextField(opts: TextFieldOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom: 8px;';

  const label = document.createElement('label');
  label.style.cssText = FIELD_LABEL;
  label.textContent = opts.label;
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.type = 'text';
  input.value = opts.value;
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.style.cssText = TEXT_INPUT;
  wrap.appendChild(input);

  opts.registry[opts.registryKey] = () => input.value;
  return wrap;
}

export interface NumberFieldOptions {
  label: string;
  value: number | undefined;
  registry: Record<string, () => number | undefined>;
  registryKey: string;
}

export function buildNumberField(opts: NumberFieldOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom: 8px;';

  const label = document.createElement('label');
  label.style.cssText = FIELD_LABEL;
  label.textContent = opts.label;
  wrap.appendChild(label);

  const input = document.createElement('input');
  input.type = 'number';
  if (opts.value !== undefined) input.value = String(opts.value);
  input.style.cssText = TEXT_INPUT;
  wrap.appendChild(input);

  opts.registry[opts.registryKey] = () => {
    const raw = input.value.trim();
    if (raw === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  return wrap;
}

/**
 * Comma-separated list field — the simplest UX for a list of strings
 * that fits a v1 editor. Phase 4 may upgrade to a chip picker for
 * draw types (a finite known set) and similar.
 */
export interface ListFieldOptions {
  label: string;
  values: string[];
  placeholder?: string;
  registry: Record<string, () => string[]>;
  registryKey: string;
  pinnedUniverse?: string[]; // settings-side: caps universe; values must be subset
}

export function buildListField(opts: ListFieldOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom: 8px;';

  const label = document.createElement('label');
  label.style.cssText = FIELD_LABEL;
  label.textContent = opts.label;
  wrap.appendChild(label);

  if (opts.pinnedUniverse !== undefined && opts.pinnedUniverse.length > 0) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size: .7rem; color: var(--tmx-text-muted, #888); margin-bottom: 2px;';
    hint.textContent = `Allowed by provisioner: ${opts.pinnedUniverse.join(', ')}`;
    wrap.appendChild(hint);
  }

  const input = document.createElement('input');
  input.type = 'text';
  input.value = opts.values.join(', ');
  if (opts.placeholder) input.placeholder = opts.placeholder;
  input.style.cssText = TEXT_INPUT;
  wrap.appendChild(input);

  opts.registry[opts.registryKey] = () =>
    input.value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  return wrap;
}

export function appendIssues(container: HTMLElement, issues: ValidationIssue[]): void {
  // Clear any previously rendered issue notes
  container.querySelectorAll('[data-issue-line]').forEach((n) => n.remove());
  if (!issues.length) return;
  for (const issue of issues) {
    const note = document.createElement('div');
    note.dataset.issueLine = '1';
    note.style.cssText = ISSUE_LINE;
    const tail = issue.disallowedValues?.length ? ` (${issue.disallowedValues.join(', ')})` : '';
    note.textContent = `${issue.path}: ${issue.message}${tail}`;
    container.appendChild(note);
  }
}
