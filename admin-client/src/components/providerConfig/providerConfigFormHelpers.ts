/**
 * Shared helpers for the provider-config editor modals (caps + settings).
 *
 * Both editors render the same shape of fields; the differences are
 * which sections appear and whether settings fields are cap-aware
 * (disabled with a "locked by provisioner" tooltip when a cap forbids).
 */
import type { ValidationIssue } from '@courthive/provider-config';

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

/**
 * Curated preset list for the themeTokens editor — surfaces the
 * frequently overridden custom properties so a provider admin can
 * fill the form by name rather than memorising the surface.
 *
 * Free-form entries are still allowed; validation happens server-side
 * via the @courthive/provider-config prefix allowlist (--tmx-* / --chc-*).
 */
export const THEME_TOKEN_PRESETS: ReadonlyArray<{ token: string; label: string }> = [
  { token: '--tmx-accent-blue', label: 'TMX primary accent' },
  { token: '--tmx-fill-accent', label: 'TMX button fill' },
  { token: '--tmx-border-focus', label: 'TMX focus ring' },
  { token: '--tmx-status-info', label: 'TMX status — info' },
  { token: '--tmx-status-warning', label: 'TMX status — warning' },
  { token: '--tmx-status-error', label: 'TMX status — error' },
  { token: '--tmx-accent-orange', label: 'TMX warm accent' },
  { token: '--tmx-bg-highlight', label: 'TMX highlight background' },
  { token: '--tmx-container-link', label: 'TMX link container fill' },
  { token: '--tmx-panel-blue-bg', label: 'TMX blue panel — bg' },
  { token: '--tmx-panel-blue-border', label: 'TMX blue panel — border' },
  { token: '--chc-text-link', label: 'CHP link color' },
  { token: '--chc-text-link-hover', label: 'CHP link hover' },
  { token: '--chc-status-info', label: 'CHP status — info' },
  { token: '--chc-container-link', label: 'CHP link container fill' },
  { token: '--chc-border-focus', label: 'CHP focus ring' },
];

const TOKEN_PREFIXES = ['--tmx-', '--chc-'] as const;

function isAllowedTokenName(token: string): boolean {
  return TOKEN_PREFIXES.some((p) => token.startsWith(p));
}

export interface ThemeTokensFieldOptions {
  label: string;
  hint?: string;
  presetLabel: string;
  presetChooseLabel: string;
  addLabel: string;
  removeLabel: string;
  tokenPlaceholder: string;
  valuePlaceholder: string;
  invalidTokenTitle: string;
  values: Record<string, string>;
  registry: Record<string, () => Record<string, string>>;
  registryKey: string;
}

/**
 * Renders a key-value editor for `themeTokens` — one row per
 * `<token>: <css-value>` entry. The reader serialises rows into a
 * `Record<string, string>` with empty rows skipped.
 */
export function buildThemeTokensField(opts: ThemeTokensFieldOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom: 8px;';

  const label = document.createElement('label');
  label.style.cssText = FIELD_LABEL;
  label.textContent = opts.label;
  wrap.appendChild(label);

  if (opts.hint) {
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size: .7rem; color: var(--tmx-text-muted, #888); margin-bottom: 6px;';
    hint.textContent = opts.hint;
    wrap.appendChild(hint);
  }

  const rowsContainer = document.createElement('div');
  rowsContainer.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
  wrap.appendChild(rowsContainer);

  // ── Toolbar (preset chooser + add button) ──
  const toolbar = document.createElement('div');
  toolbar.style.cssText = 'display: flex; gap: 6px; align-items: center; margin-top: 6px;';

  const select = document.createElement('select');
  select.style.cssText =
    'flex: 1; padding: 4px 8px; border: 1px solid var(--tmx-border-primary, #ccc); border-radius: 4px; font-size: .8rem; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636);';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = opts.presetChooseLabel;
  select.appendChild(placeholder);
  for (const preset of THEME_TOKEN_PRESETS) {
    const opt = document.createElement('option');
    opt.value = preset.token;
    opt.textContent = `${preset.label}  (${preset.token})`;
    select.appendChild(opt);
  }
  toolbar.appendChild(select);

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.textContent = opts.addLabel;
  addButton.style.cssText =
    'padding: 4px 10px; border: 1px solid var(--tmx-border-primary, #ccc); border-radius: 4px; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636); font-size: .8rem; cursor: pointer;';
  toolbar.appendChild(addButton);
  wrap.appendChild(toolbar);

  const rowReaders: Array<() => { token: string; value: string } | undefined> = [];

  function appendRow(initialToken = '', initialValue = ''): void {
    const row = document.createElement('div');
    row.style.cssText = 'display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1.6fr) auto; gap: 6px;';

    const tokenInput = document.createElement('input');
    tokenInput.type = 'text';
    tokenInput.value = initialToken;
    tokenInput.placeholder = opts.tokenPlaceholder;
    tokenInput.style.cssText = TEXT_INPUT;
    function reflectValidity(): void {
      const v = tokenInput.value.trim();
      const ok = v === '' || isAllowedTokenName(v);
      tokenInput.style.borderColor = ok ? '' : 'var(--tmx-status-error, #d33)';
      tokenInput.title = ok ? '' : opts.invalidTokenTitle;
    }
    tokenInput.addEventListener('input', reflectValidity);
    reflectValidity();

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.value = initialValue;
    valueInput.placeholder = opts.valuePlaceholder;
    valueInput.style.cssText = TEXT_INPUT;

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = opts.removeLabel;
    removeButton.style.cssText =
      'padding: 4px 8px; border: 1px solid var(--tmx-border-primary, #ccc); border-radius: 4px; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-secondary, #555); font-size: .75rem; cursor: pointer;';

    row.appendChild(tokenInput);
    row.appendChild(valueInput);
    row.appendChild(removeButton);
    rowsContainer.appendChild(row);

    const index = rowReaders.length;
    rowReaders.push(() => {
      const token = tokenInput.value.trim();
      const value = valueInput.value.trim();
      if (!token || !value) return undefined;
      return { token, value };
    });
    removeButton.addEventListener('click', () => {
      rowReaders[index] = () => undefined;
      row.remove();
    });
  }

  // Initial population from existing tokens
  for (const [token, value] of Object.entries(opts.values ?? {})) {
    appendRow(token, value);
  }

  addButton.addEventListener('click', () => appendRow());
  select.addEventListener('change', () => {
    if (!select.value) return;
    appendRow(select.value);
    select.value = '';
  });

  opts.registry[opts.registryKey] = () => {
    const out: Record<string, string> = {};
    for (const read of rowReaders) {
      const entry = read();
      if (entry) out[entry.token] = entry.value;
    }
    return out;
  };

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
