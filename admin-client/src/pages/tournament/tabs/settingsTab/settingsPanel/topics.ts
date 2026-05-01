/**
 * Topic registry for the Settings panel. Each topic owns a chunk of
 * `providerConfigSettings` and renders into the right-hand content
 * column when the user picks it from the nav.
 *
 * Phase 3a: Defaults + Permissions are real editors that mutate the
 *   shared `draft` and call `onChange`. Other topics still render
 *   read-only summaries until Phase 3b–d.
 *
 * See `Mentat/planning/ADMIN_SETTINGS_PAGE_REDESIGN.md`.
 */
import { PERMISSION_GROUPS } from 'types/providerConfig';
import type {
  AllowedCategory,
  ProviderConfigCaps,
  ProviderConfigSettings,
} from 'types/providerConfig';
import {
  createPrintCompositionEditor,
  getAgeCategoryModal,
  type PrintCompositionConfig,
  type PrintCompositionEditorHandle,
  type PrintType,
} from 'courthive-components';
import {
  CREATION_METHOD_OPTIONS,
  DRAW_TYPE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
} from './constants';
import { chipMultiSelect } from './widgets';

export type TopicId = 'permissions' | 'allowed' | 'policies' | 'defaults' | 'print' | 'categories';

export interface TopicContext {
  caps: ProviderConfigCaps;
  /**
   * The mutable working draft. Topics mutate this directly and call
   * `onChange()` so the panel can recompute dirty state and refresh
   * the Save button. The panel deep-clones loaded settings into this
   * draft, so mutations don't touch the original.
   */
  draft: ProviderConfigSettings;
  onChange: () => void;
}

export interface TopicDescriptor {
  id: TopicId;
  label: string;
  icon: string;
  render: (host: HTMLElement, ctx: TopicContext) => void;
}

export const TOPICS: TopicDescriptor[] = [
  { id: 'permissions', label: 'Permissions', icon: 'fa-shield-halved', render: renderPermissions },
  { id: 'allowed', label: 'Allowed Selections', icon: 'fa-list-check', render: renderAllowed },
  { id: 'policies', label: 'Policies', icon: 'fa-scale-balanced', render: renderPolicies },
  { id: 'defaults', label: 'Defaults', icon: 'fa-sliders', render: renderDefaults },
  { id: 'print', label: 'Print Configuration', icon: 'fa-print', render: renderPrint },
  { id: 'categories', label: 'Categories', icon: 'fa-layer-group', render: renderCategories },
];

// ── Permissions (real editor) ──────────────────────────────────────────────

function renderPermissions(host: HTMLElement, ctx: TopicContext): void {
  const root = topicShell(
    'Permissions',
    'Allow or deny capabilities for tournament directors. Caps locked by the provisioner are shown but cannot be enabled.',
  );
  host.appendChild(root);
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;

  for (const group of PERMISSION_GROUPS) {
    const block = document.createElement('div');
    block.className = 'sp-perm-group';

    const heading = document.createElement('h5');
    heading.className = 'sp-perm-group-title';
    heading.textContent = group.label;
    block.appendChild(heading);

    const grid = document.createElement('div');
    grid.className = 'sp-perm-grid';

    for (const key of group.keys) {
      const capForbids = (ctx.caps.permissions as any)?.[key] === false;
      const settingsBlock = ctx.draft.permissions ?? {};
      const current = (settingsBlock as any)[key];
      // Render-time effective value: cap-forbidden is always false; otherwise
      // honor the explicit setting; otherwise default to true (permissive).
      const checked = capForbids ? false : current === undefined ? true : !!current;

      const label = document.createElement('label');
      label.className = 'sp-perm-item' + (capForbids ? ' is-locked' : '');
      label.title = capForbids ? 'Locked by provisioner' : '';

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = checked;
      input.disabled = capForbids;
      input.addEventListener('change', () => {
        if (capForbids) return;
        ctx.draft.permissions = { ...(ctx.draft.permissions ?? {}) };
        (ctx.draft.permissions as any)[key] = input.checked;
        ctx.onChange();
      });

      const text = document.createElement('span');
      text.className = 'sp-perm-label';
      text.textContent = humanize(String(key));

      const lockIcon = document.createElement('i');
      if (capForbids) {
        lockIcon.className = 'fa-solid fa-lock';
        lockIcon.setAttribute('aria-hidden', 'true');
      }

      label.appendChild(input);
      label.appendChild(text);
      if (capForbids) label.appendChild(lockIcon);
      grid.appendChild(label);
    }

    block.appendChild(grid);
    body.appendChild(block);
  }
}

// ── Defaults (real editor) ─────────────────────────────────────────────────

function renderDefaults(host: HTMLElement, ctx: TopicContext): void {
  const root = topicShell(
    'Defaults',
    'Pre-fill values for new tournament/event/draw creation flows. Empty = no default.',
  );
  host.appendChild(root);
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;

  body.appendChild(
    selectField({
      label: 'Default Event Type',
      value: ctx.draft.defaults?.defaultEventType,
      options: [...EVENT_TYPE_OPTIONS],
      onChange: (v) => setDefault(ctx, 'defaultEventType', v),
    }),
  );
  body.appendChild(
    selectField({
      label: 'Default Draw Type',
      value: ctx.draft.defaults?.defaultDrawType,
      options: [...DRAW_TYPE_OPTIONS],
      onChange: (v) => setDefault(ctx, 'defaultDrawType', v),
    }),
  );
  body.appendChild(
    selectField({
      label: 'Default Creation Method',
      value: ctx.draft.defaults?.defaultCreationMethod,
      options: [...CREATION_METHOD_OPTIONS],
      onChange: (v) => setDefault(ctx, 'defaultCreationMethod', v),
    }),
  );
  body.appendChild(
    selectField({
      label: 'Default Gender',
      value: ctx.draft.defaults?.defaultGender,
      options: [...GENDER_OPTIONS],
      onChange: (v) => setDefault(ctx, 'defaultGender', v),
    }),
  );
}

function setDefault(
  ctx: TopicContext,
  key: 'defaultEventType' | 'defaultDrawType' | 'defaultCreationMethod' | 'defaultGender',
  value: string,
): void {
  ctx.draft.defaults = { ...(ctx.draft.defaults ?? {}) };
  if (value) {
    ctx.draft.defaults[key] = value;
  } else {
    delete ctx.draft.defaults[key];
  }
  ctx.onChange();
}

// ── Other topics (Phase 2 read-only summaries; editors land in 3b–d) ──────

function renderAllowed(host: HTMLElement, ctx: TopicContext): void {
  const root = topicShell(
    'Allowed Selections',
    'Narrow the provisioner-allowed universe. Click a chip to toggle. Empty list = inherit caps unchanged.',
  );
  host.appendChild(root);
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;

  body.appendChild(
    chipMultiSelect({
      label: 'Draw Types',
      values: ctx.draft.permissions?.allowedDrawTypes ?? [],
      pinnedUniverse: ctx.caps.permissions?.allowedDrawTypes,
      placeholder: 'Add draw type…',
      onChange: (next) => setPermArray(ctx, 'allowedDrawTypes', next),
    }),
  );
  body.appendChild(
    chipMultiSelect({
      label: 'Creation Methods',
      values: ctx.draft.permissions?.allowedCreationMethods ?? [],
      pinnedUniverse: ctx.caps.permissions?.allowedCreationMethods,
      placeholder: 'Add creation method…',
      onChange: (next) => setPermArray(ctx, 'allowedCreationMethods', next),
    }),
  );
  body.appendChild(
    chipMultiSelect({
      label: 'Scoring Approaches',
      values: ctx.draft.permissions?.allowedScoringApproaches ?? [],
      pinnedUniverse: ctx.caps.permissions?.allowedScoringApproaches,
      placeholder: 'Add scoring approach…',
      onChange: (next) => setPermArray(ctx, 'allowedScoringApproaches', next),
    }),
  );
  body.appendChild(
    chipMultiSelect({
      label: 'MatchUp Formats',
      values: ctx.draft.policies?.allowedMatchUpFormats ?? [],
      pinnedUniverse: ctx.caps.policies?.allowedMatchUpFormats,
      placeholder: 'Add matchUp format code…',
      onChange: (next) => setPolicyArray(ctx, 'allowedMatchUpFormats', next),
    }),
  );
}

function setPermArray(
  ctx: TopicContext,
  key: 'allowedDrawTypes' | 'allowedCreationMethods' | 'allowedScoringApproaches',
  next: string[],
): void {
  ctx.draft.permissions = { ...(ctx.draft.permissions ?? {}) };
  if (next.length) {
    ctx.draft.permissions[key] = next;
  } else {
    delete ctx.draft.permissions[key];
  }
  ctx.onChange();
}

function setPolicyArray(ctx: TopicContext, key: 'allowedMatchUpFormats', next: string[]): void {
  ctx.draft.policies = { ...(ctx.draft.policies ?? {}) };
  if (next.length) {
    ctx.draft.policies[key] = next;
  } else {
    delete ctx.draft.policies[key];
  }
  ctx.onChange();
}

type PolicyKey = 'schedulingPolicy' | 'scoringPolicy' | 'seedingPolicy';

interface PolicyDescriptor {
  key: PolicyKey;
  label: string;
  description: string;
}

const POLICY_DESCRIPTORS: PolicyDescriptor[] = [
  {
    key: 'schedulingPolicy',
    label: 'Scheduling',
    description:
      'Average match times, recovery windows between matches, daily match limits per participant.',
  },
  {
    key: 'scoringPolicy',
    label: 'Scoring',
    description: 'Allowed matchUp formats, default format selection, ready-to-score conditions.',
  },
  {
    key: 'seedingPolicy',
    label: 'Seeding',
    description: 'Seed positioning patterns and thresholds for the number of seeds per draw size.',
  },
];

function renderPolicies(host: HTMLElement, ctx: TopicContext): void {
  const root = topicShell(
    'Policies',
    'Static configuration the factory engines consume. Each policy has an editable name and a JSON body — structured forms per policy type land when the schemas are pinned.',
  );
  host.appendChild(root);
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;

  for (const desc of POLICY_DESCRIPTORS) {
    body.appendChild(buildPolicyCard(ctx, desc));
  }
}

function buildPolicyCard(ctx: TopicContext, desc: PolicyDescriptor): HTMLElement {
  const card = document.createElement('section');
  card.className = 'sp-policy-card';

  const head = document.createElement('header');
  head.className = 'sp-policy-card-header';

  const heading = document.createElement('div');
  heading.className = 'sp-policy-card-heading';

  const titleRow = document.createElement('div');
  titleRow.className = 'sp-policy-card-title-row';
  const title = document.createElement('h5');
  title.className = 'sp-policy-card-title';
  title.textContent = desc.label;
  const status = document.createElement('span');
  status.className = 'sp-policy-status';
  titleRow.appendChild(title);
  titleRow.appendChild(status);
  heading.appendChild(titleRow);

  const description = document.createElement('p');
  description.className = 'sp-policy-card-description';
  description.textContent = desc.description;
  heading.appendChild(description);

  head.appendChild(heading);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'sp-policy-reset-btn';
  resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reset';
  resetBtn.title = 'Remove this policy from the draft';
  head.appendChild(resetBtn);

  card.appendChild(head);

  const nameField = document.createElement('label');
  nameField.className = 'sp-field';
  const nameLabel = document.createElement('span');
  nameLabel.className = 'sp-field-label';
  nameLabel.textContent = 'Policy name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'sp-field-input';
  nameInput.placeholder = 'Optional human-readable label';
  nameField.appendChild(nameLabel);
  nameField.appendChild(nameInput);
  card.appendChild(nameField);

  // Collapsible JSON editor for the rest of the policy.
  const jsonWrap = document.createElement('details');
  jsonWrap.className = 'sp-policy-json';

  const summary = document.createElement('summary');
  summary.className = 'sp-policy-json-summary';
  summary.innerHTML = '<i class="fa-solid fa-code"></i> Advanced (JSON)';
  jsonWrap.appendChild(summary);

  const ta = document.createElement('textarea');
  ta.className = 'sp-policy-json-input';
  ta.rows = 6;
  ta.spellcheck = false;
  ta.placeholder = '{\n  "...": "..."\n}';
  jsonWrap.appendChild(ta);

  const jsonError = document.createElement('div');
  jsonError.className = 'sp-policy-json-error';
  jsonError.style.display = 'none';
  jsonWrap.appendChild(jsonError);

  card.appendChild(jsonWrap);

  // ── Wire state ────────────────────────────────────────────────────────

  const refresh = () => {
    const policy = (ctx.draft.policies?.[desc.key] ?? undefined) as Record<string, any> | undefined;
    const isSet = policy && Object.keys(policy).length > 0;
    status.textContent = isSet ? 'configured' : 'using defaults';
    status.classList.toggle('is-configured', !!isSet);

    nameInput.value = (policy?.policyName as string) ?? '';

    // Body view excludes policyName so the JSON editor only shows the rest.
    const { policyName: _omit, ...rest } = (policy ?? {}) as Record<string, any>;
    void _omit;
    ta.value = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : '';
    jsonError.style.display = 'none';
  };

  const writePolicy = (next: Record<string, any> | undefined) => {
    ctx.draft.policies = { ...(ctx.draft.policies ?? {}) };
    if (next && Object.keys(next).length > 0) {
      (ctx.draft.policies as any)[desc.key] = next;
    } else {
      delete (ctx.draft.policies as any)[desc.key];
    }
    ctx.onChange();
    refresh();
  };

  nameInput.addEventListener('input', () => {
    const current = ((ctx.draft.policies?.[desc.key] ?? {}) as Record<string, any>) || {};
    const next = { ...current };
    if (nameInput.value.trim()) {
      next.policyName = nameInput.value;
    } else {
      delete next.policyName;
    }
    writePolicy(next);
  });

  ta.addEventListener('input', () => {
    const raw = ta.value.trim();
    if (raw === '') {
      // Clear the body but preserve policyName if set.
      const current = ((ctx.draft.policies?.[desc.key] ?? {}) as Record<string, any>) || {};
      const policyName = current.policyName;
      writePolicy(policyName ? { policyName } : undefined);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        showJsonError('Policy body must be a JSON object.');
        return;
      }
      jsonError.style.display = 'none';
      const current = ((ctx.draft.policies?.[desc.key] ?? {}) as Record<string, any>) || {};
      const policyName = current.policyName;
      const next = policyName ? { policyName, ...parsed } : { ...parsed };
      writePolicy(next);
    } catch (err) {
      showJsonError(err instanceof Error ? err.message : 'Invalid JSON.');
    }
  });

  resetBtn.addEventListener('click', () => writePolicy(undefined));

  function showJsonError(message: string): void {
    jsonError.textContent = message;
    jsonError.style.display = '';
  }

  refresh();
  return card;
}

const PRINT_TYPES: PrintType[] = ['draw', 'schedule', 'playerList', 'courtCard', 'signInSheet', 'matchCard'];

function renderPrint(host: HTMLElement, ctx: TopicContext): void {
  const root = topicShell(
    'Print Configuration',
    "Per-print-type composition policies. ●/○ markers in the picker show which types have a saved policy. Reset clears the active type's policy and falls back to pdf-factory defaults.",
  );
  host.appendChild(root);
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;

  const printPolicies = ((ctx.draft.policies as any)?.printPolicies ?? {}) as Record<string, unknown>;

  // Type picker + reset
  const controls = document.createElement('div');
  controls.className = 'sp-print-controls';

  const picker = document.createElement('select');
  picker.className = 'sp-field-input';
  picker.setAttribute('aria-label', 'Print type');
  for (const type of PRINT_TYPES) {
    const o = document.createElement('option');
    o.value = type;
    o.textContent = configuredFlag(printPolicies, type) + type;
    picker.appendChild(o);
  }
  controls.appendChild(picker);

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'sp-row-add-btn';
  resetBtn.innerHTML = '<i class="fa-solid fa-rotate-left"></i> Reset to defaults';
  resetBtn.title = "Remove this provider's policy for the selected print type";
  controls.appendChild(resetBtn);

  body.appendChild(controls);

  const editorHost = document.createElement('div');
  editorHost.className = 'sp-print-editor-host';
  body.appendChild(editorHost);

  let active: PrintType = PRINT_TYPES[0];
  let handle: PrintCompositionEditorHandle | null = null;

  function refreshPicker(): void {
    for (let i = 0; i < picker.options.length; i++) {
      const opt = picker.options[i];
      const t = opt.value as PrintType;
      opt.textContent = configuredFlag(printPolicies, t) + t;
    }
  }

  function writePolicy(type: PrintType, cfg: PrintCompositionConfig): void {
    ctx.draft.policies = { ...(ctx.draft.policies ?? {}) };
    const existing = ((ctx.draft.policies as any).printPolicies ?? {}) as Record<string, unknown>;
    const next = { ...existing };
    if (cfg && Object.keys(cfg).length > 0) {
      next[type] = cfg;
    } else {
      delete next[type];
    }
    if (Object.keys(next).length > 0) {
      (ctx.draft.policies as any).printPolicies = next;
    } else {
      delete (ctx.draft.policies as any).printPolicies;
    }
    // Keep the local snapshot in lockstep so picker markers reflect edits.
    Object.keys(printPolicies).forEach((k) => delete printPolicies[k]);
    Object.assign(printPolicies, next);
    ctx.onChange();
    refreshPicker();
  }

  function mount(type: PrintType): void {
    handle?.destroy();
    const existing = (printPolicies[type] ?? {}) as PrintCompositionConfig;
    handle = createPrintCompositionEditor(editorHost, {
      printType: type,
      config: existing,
      onChange: (cfg) => writePolicy(type, cfg),
    });
  }

  picker.addEventListener('change', () => {
    active = picker.value as PrintType;
    mount(active);
  });

  resetBtn.addEventListener('click', () => {
    writePolicy(active, {} as PrintCompositionConfig);
    mount(active);
  });

  mount(active);
}

function configuredFlag(map: Record<string, unknown>, type: string): string {
  const cfg = map[type];
  return cfg && typeof cfg === 'object' && Object.keys(cfg as object).length > 0 ? '● ' : '○ ';
}

function renderCategories(host: HTMLElement, ctx: TopicContext): void {
  const root = topicShell(
    'Categories',
    'Restrict event categories. Empty list = all caps-allowed categories available. Click the code chip to open the Age Category editor.',
  );
  host.appendChild(root);
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;

  const universe = ctx.caps.policies?.allowedCategories ?? [];
  const rows: AllowedCategory[] = [...(ctx.draft.policies?.allowedCategories ?? [])];

  const tableHost = document.createElement('div');
  tableHost.className = 'sp-row-editor';
  body.appendChild(tableHost);

  const table = document.createElement('div');
  table.className = 'sp-row-table';
  tableHost.appendChild(table);

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'sp-row-add-btn';
  addBtn.innerHTML = '<i class="fa-solid fa-plus"></i> Add category';
  addBtn.addEventListener('click', () => {
    rows.push({ ageCategoryCode: '', categoryName: '' });
    emit();
    rebuild();
    // Auto-launch the editor for the new (empty) row.
    openCodeEditor(rows.length - 1);
  });
  tableHost.appendChild(addBtn);

  if (universe.length) {
    const hint = document.createElement('div');
    hint.className = 'sp-row-hint';
    hint.textContent = `Provisioner-allowed: ${universe.map((c) => c.ageCategoryCode).join(', ')}`;
    tableHost.appendChild(hint);
  }

  function emit(): void {
    const cleaned = rows.filter((r) => r.ageCategoryCode?.trim());
    ctx.draft.policies = { ...(ctx.draft.policies ?? {}) };
    if (cleaned.length) {
      ctx.draft.policies.allowedCategories = cleaned;
    } else {
      delete ctx.draft.policies.allowedCategories;
    }
    ctx.onChange();
  }

  function openCodeEditor(idx: number): void {
    const current = rows[idx];
    getAgeCategoryModal({
      existingAgeCategoryCode: current?.ageCategoryCode || undefined,
      callback: (result: { ageCategoryCode: string; [key: string]: any }) => {
        if (!result?.ageCategoryCode) return;
        rows[idx] = {
          ...rows[idx],
          ageCategoryCode: result.ageCategoryCode,
        };
        emit();
        rebuild();
      },
    });
  }

  function rebuild(): void {
    table.innerHTML = '';

    const headerRow = document.createElement('div');
    headerRow.className = 'sp-row-header';
    const codeHead = document.createElement('div');
    codeHead.className = 'sp-row-cell-header';
    codeHead.textContent = 'Age Category Code *';
    const nameHead = document.createElement('div');
    nameHead.className = 'sp-row-cell-header';
    nameHead.textContent = 'Display Name';
    headerRow.appendChild(codeHead);
    headerRow.appendChild(nameHead);
    headerRow.appendChild(document.createElement('div'));
    table.appendChild(headerRow);

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'sp-row-empty';
      empty.textContent = 'No categories. Click Add category to start.';
      table.appendChild(empty);
      return;
    }

    rows.forEach((row, idx) => {
      const tr = document.createElement('div');
      tr.className = 'sp-row';

      // Code column — chip-style button that opens the age-category modal.
      const codeCell = document.createElement('div');
      codeCell.className = 'sp-row-cell';
      const codeBtn = document.createElement('button');
      codeBtn.type = 'button';
      codeBtn.className = 'sp-category-code-btn' + (row.ageCategoryCode ? ' is-set' : '');
      codeBtn.innerHTML = row.ageCategoryCode
        ? `<span>${escapeHtml(row.ageCategoryCode)}</span><i class="fa-solid fa-pen-to-square"></i>`
        : '<span><em>Choose code…</em></span><i class="fa-solid fa-arrow-right"></i>';
      codeBtn.addEventListener('click', () => openCodeEditor(idx));
      codeCell.appendChild(codeBtn);
      tr.appendChild(codeCell);

      // Display name — free text.
      const nameCell = document.createElement('div');
      nameCell.className = 'sp-row-cell';
      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'sp-field-input';
      nameInput.placeholder = 'e.g., Under 18';
      nameInput.value = row.categoryName ?? '';
      nameInput.addEventListener('input', () => {
        rows[idx] = { ...rows[idx], categoryName: nameInput.value };
        emit();
      });
      nameCell.appendChild(nameInput);
      tr.appendChild(nameCell);

      const delCell = document.createElement('div');
      delCell.className = 'sp-row-cell-delete';
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'sp-row-del-btn';
      delBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
      delBtn.title = 'Remove category';
      delBtn.addEventListener('click', () => {
        rows.splice(idx, 1);
        emit();
        rebuild();
      });
      delCell.appendChild(delBtn);
      tr.appendChild(delCell);

      table.appendChild(tr);
    });
  }

  rebuild();
}

// ── Helpers ────────────────────────────────────────────────────────────────

function topicShell(title: string, description: string): HTMLElement {
  const root = document.createElement('section');
  root.className = 'sp-topic';
  root.innerHTML = `
    <header class="sp-topic-header">
      <h4>${escapeHtml(title)}</h4>
      <p class="sp-topic-description">${escapeHtml(description)}</p>
    </header>
    <div class="sp-topic-body"></div>
  `;
  return root;
}

interface SelectFieldOpts {
  label: string;
  value?: string;
  options: string[];
  onChange: (value: string) => void;
}

function selectField(opts: SelectFieldOpts): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'sp-field';

  const label = document.createElement('span');
  label.className = 'sp-field-label';
  label.textContent = opts.label;
  wrap.appendChild(label);

  const select = document.createElement('select');
  select.className = 'sp-field-input';

  // Empty option = "no default"
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '— not set —';
  select.appendChild(blank);

  for (const opt of opts.options) {
    const o = document.createElement('option');
    o.value = opt;
    o.textContent = opt;
    if (opts.value === opt) o.selected = true;
    select.appendChild(o);
  }

  // If the existing value isn't in the option list (legacy / custom),
  // surface it so we don't silently swallow it.
  if (opts.value && !opts.options.includes(opts.value)) {
    const o = document.createElement('option');
    o.value = opts.value;
    o.textContent = opts.value + ' (custom)';
    o.selected = true;
    select.appendChild(o);
  }

  select.addEventListener('change', () => opts.onChange(select.value));
  wrap.appendChild(select);
  return wrap;
}

function humanize(key: string): string {
  return key
    .replace(/^can/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
