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
import type { ProviderConfigCaps, ProviderConfigSettings, ProviderPermissions } from 'types/providerConfig';
import {
  CREATION_METHOD_OPTIONS,
  DRAW_TYPE_OPTIONS,
  EVENT_TYPE_OPTIONS,
  GENDER_OPTIONS,
} from './constants';

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
  const perm: ProviderPermissions = ctx.draft.permissions ?? {};
  const pol = ctx.draft.policies ?? {};
  const rows: string[] = [];
  const add = (label: string, list: string[] | undefined) => {
    if (!list || !list.length) return;
    rows.push(`<li><strong>${label}:</strong> ${list.map((v) => `<code>${escapeHtml(v)}</code>`).join(' ')}</li>`);
  };
  add('Draw Types', perm.allowedDrawTypes);
  add('Creation Methods', perm.allowedCreationMethods);
  add('Scoring Approaches', perm.allowedScoringApproaches);
  add('MatchUp Formats', pol.allowedMatchUpFormats);
  const root = topicShell(
    'Allowed Selections',
    'Narrowing within the provisioner-allowed universe. Multi-select chip editor lands in Phase 3b.',
  );
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;
  body.innerHTML = rows.length
    ? `<ul class="sp-summary-list">${rows.join('')}</ul>`
    : '<p class="sp-summary-empty"><em>No narrowing applied — inheriting all caps.</em></p>';
  host.appendChild(root);
}

function renderPolicies(host: HTMLElement, ctx: TopicContext): void {
  const pol = ctx.draft.policies ?? {};
  const has = (v: any) => v !== undefined && v !== null && Object.keys(v ?? {}).length > 0;
  const rows = [
    { label: 'Scheduling Policy', set: has(pol.schedulingPolicy) },
    { label: 'Scoring Policy', set: has(pol.scoringPolicy) },
    { label: 'Seeding Policy', set: has(pol.seedingPolicy) },
  ];
  const root = topicShell(
    'Policies',
    'Static configuration the factory engines consume. Structured editors land in Phase 3d.',
  );
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;
  body.innerHTML = `<ul class="sp-summary-list">${rows
    .map((r) => `<li><strong>${r.label}:</strong> ${r.set ? 'configured' : '<em>using defaults</em>'}</li>`)
    .join('')}</ul>`;
  host.appendChild(root);
}

function renderPrint(host: HTMLElement, ctx: TopicContext): void {
  const printPolicies = (ctx.draft.policies as any)?.printPolicies ?? {};
  const types = ['draw', 'schedule', 'playerList', 'courtCard', 'signInSheet', 'matchCard'];
  const rows = types
    .map((type) => {
      const cfg = printPolicies[type];
      const configured = cfg && typeof cfg === 'object' && Object.keys(cfg).length > 0;
      return `<li>${configured ? '●' : '○'} <code>${type}</code> ${configured ? '' : '<em>(uses pdf-factory defaults)</em>'}</li>`;
    })
    .join('');
  const root = topicShell(
    'Print Configuration',
    'Per-print-type composition policies. The composition editor embeds here in Phase 3c.',
  );
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;
  body.innerHTML = `<ul class="sp-summary-list">${rows}</ul>`;
  host.appendChild(root);
}

function renderCategories(host: HTMLElement, ctx: TopicContext): void {
  const cats = ctx.draft.policies?.allowedCategories ?? [];
  const rows = cats.length
    ? cats
        .map(
          (c) =>
            `<li><code>${escapeHtml(c.ageCategoryCode)}</code>${c.categoryName ? ` — ${escapeHtml(c.categoryName)}` : ''}</li>`,
        )
        .join('')
    : '<li><em>No categories restricted — all caps-allowed categories available.</em></li>';
  const root = topicShell(
    'Categories',
    'Restrict event categories to this list. Row editor lands in Phase 3b.',
  );
  const body = root.querySelector<HTMLElement>('.sp-topic-body')!;
  body.innerHTML = `<ul class="sp-summary-list">${rows}</ul>`;
  host.appendChild(root);
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
