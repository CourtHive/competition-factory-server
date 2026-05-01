/**
 * Provider settings panel — full-width in-page editor that replaces
 * the old Quick Actions → Edit Settings modal. Two-column layout:
 * topic nav on the left, structured editor on the right. Persists to
 * `providerConfigSettings` via the existing `updateProviderSettings`
 * API.
 *
 * Phase 1: layout + topic nav skeleton.
 * Phase 2: fetch raw config on mount + topic switching.
 * Phase 3a (this): mutable draft, dirty tracking, panel-level Save,
 *   real editors for Defaults + Permissions. Other topics stay as
 *   read-only summaries until 3b–d.
 *
 * See `Mentat/planning/ADMIN_SETTINGS_PAGE_REDESIGN.md`.
 */
import './settingsPanel.css';
import { getRawProviderConfig, updateProviderSettings } from 'services/apis/providerConfigApi';
import { tmxToast } from 'services/notifications/tmxToast';
import { t } from 'i18n';
import type { ProviderValue } from 'types/tmx';
import type { ProviderConfigCaps, ProviderConfigSettings, ValidationIssue } from 'types/providerConfig';
import { TOPICS, type TopicContext, type TopicId } from './topics';

interface RenderSettingsPanelParams {
  provider: ProviderValue;
  isSuperAdmin?: boolean;
}

interface PanelState {
  status: 'loading' | 'ready' | 'error' | 'saving';
  caps: ProviderConfigCaps;
  /** Last-known persisted shape — used as the dirty-comparison baseline. */
  original: ProviderConfigSettings;
  /** Mutable working copy — topics edit this. */
  draft: ProviderConfigSettings;
  activeTopic: TopicId;
  errorMessage?: string;
  validationIssues?: ValidationIssue[];
}

export function renderSettingsPanel(grid: HTMLElement, params: RenderSettingsPanelParams): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-gray sp-panel';
  panel.style.gridColumn = '1 / -1';
  panel.dataset.providerId = params.provider.organisationId;
  if (params.isSuperAdmin) panel.dataset.superAdmin = 'true';

  const state: PanelState = {
    status: 'loading',
    caps: {},
    original: {},
    draft: {},
    activeTopic: TOPICS[0].id,
  };

  const headerEl = document.createElement('div');
  headerEl.className = 'sp-panel-header';
  panel.appendChild(headerEl);

  const layout = document.createElement('div');
  layout.className = 'sp-layout';
  panel.appendChild(layout);

  const navHost = document.createElement('nav');
  navHost.className = 'sp-nav';
  navHost.setAttribute('aria-label', 'Settings topics');
  layout.appendChild(navHost);

  const contentHost = document.createElement('div');
  contentHost.className = 'sp-content';
  contentHost.setAttribute('aria-live', 'polite');
  layout.appendChild(contentHost);

  grid.appendChild(panel);

  const ui = {
    saveBtn: null as HTMLButtonElement | null,
    dirtyDot: null as HTMLElement | null,
  };

  const onChange = () => {
    refreshDirty();
  };

  const onSelectTopic = (id: TopicId) => {
    state.activeTopic = id;
    updateNavActive(navHost, state.activeTopic);
    rerenderContent(contentHost, state, onChange);
  };

  const onSave = async () => {
    if (state.status !== 'ready' && state.status !== 'error') return;
    if (!isDirty(state)) return;
    state.status = 'saving';
    refreshHeader();
    try {
      const res: any = await updateProviderSettings(params.provider.organisationId, state.draft);
      if (res?.data?.code === 'SETTINGS_INVALID') {
        state.validationIssues = res.data.issues as ValidationIssue[];
        state.status = 'ready';
        tmxToast({ message: t('providerConfig.invalid'), intent: 'is-danger' });
        rerenderContent(contentHost, state, onChange);
        refreshHeader();
        return;
      }
      if (res?.data?.error) {
        state.status = 'ready';
        tmxToast({ message: res.data.error, intent: 'is-danger' });
        refreshHeader();
        return;
      }
      // Saved — make the current draft the new baseline.
      state.original = deepClone(state.draft);
      state.validationIssues = undefined;
      state.status = 'ready';
      tmxToast({ message: t('providerConfig.settingsSaved'), intent: 'is-success' });
      rerenderContent(contentHost, state, onChange);
      refreshHeader();
    } catch (err) {
      state.status = 'ready';
      tmxToast({ message: t('providerConfig.saveFailed'), intent: 'is-danger' });
      refreshHeader();
       
      console.error('[settingsPanel] save failed', err);
    }
  };

  const refreshHeader = () => {
    headerEl.innerHTML = '';
    const title = document.createElement('h3');
    title.innerHTML = '<i class="fa-solid fa-sliders"></i> Settings';
    headerEl.appendChild(title);

    ui.dirtyDot = document.createElement('span');
    ui.dirtyDot.className = 'sp-dirty-dot';
    ui.dirtyDot.title = 'Unsaved changes';
    if (!isDirty(state)) ui.dirtyDot.style.visibility = 'hidden';
    headerEl.appendChild(ui.dirtyDot);

    const spacer = document.createElement('div');
    spacer.style.flex = '1';
    headerEl.appendChild(spacer);

    ui.saveBtn = document.createElement('button');
    ui.saveBtn.type = 'button';
    ui.saveBtn.className = 'sp-save-btn';
    ui.saveBtn.disabled = !isDirty(state) || state.status === 'saving' || state.status === 'loading';
    ui.saveBtn.innerHTML =
      state.status === 'saving'
        ? '<i class="fa-solid fa-spinner fa-spin"></i> Saving…'
        : '<i class="fa-solid fa-floppy-disk"></i> Save';
    ui.saveBtn.addEventListener('click', () => void onSave());
    headerEl.appendChild(ui.saveBtn);
  };

  const refreshDirty = () => {
    if (!ui.dirtyDot || !ui.saveBtn) return;
    const dirty = isDirty(state);
    ui.dirtyDot.style.visibility = dirty ? 'visible' : 'hidden';
    ui.saveBtn.disabled = !dirty || state.status === 'saving' || state.status === 'loading';
  };

  buildNav(navHost, state.activeTopic, onSelectTopic);
  refreshHeader();
  rerenderContent(contentHost, state, onChange);

  void loadConfig(params.provider.organisationId, state, () => {
    rerenderContent(contentHost, state, onChange);
    refreshHeader();
  });
}

async function loadConfig(providerId: string, state: PanelState, onLoaded: () => void): Promise<void> {
  try {
    const res: any = await getRawProviderConfig(providerId);
    if (res?.data?.error) {
      state.status = 'error';
      state.errorMessage = res.data.error;
    } else {
      state.caps = (res?.data?.caps ?? {}) as ProviderConfigCaps;
      state.original = (res?.data?.settings ?? {}) as ProviderConfigSettings;
      state.draft = deepClone(state.original);
      state.status = 'ready';
    }
  } catch (err) {
    state.status = 'error';
    state.errorMessage = err instanceof Error ? err.message : t('system.loadError');
    tmxToast({ message: t('system.loadError'), intent: 'is-danger' });
  }
  onLoaded();
}

function buildNav(navHost: HTMLElement, activeId: TopicId, onSelect: (id: TopicId) => void): void {
  for (const topic of TOPICS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'sp-nav-item';
    item.dataset.topic = topic.id;
    const isActive = topic.id === activeId;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-pressed', String(isActive));
    item.innerHTML = `<i class="fa-solid ${topic.icon}"></i><span>${topic.label}</span>`;
    item.addEventListener('click', () => onSelect(topic.id));
    navHost.appendChild(item);
  }
}

/**
 * The Phase 2 bug: nav highlight only set at construction. Now the
 * panel calls this on every topic switch so the active item tracks
 * the current selection.
 */
function updateNavActive(navHost: HTMLElement, activeId: TopicId): void {
  navHost.querySelectorAll<HTMLButtonElement>('.sp-nav-item').forEach((btn) => {
    const isActive = btn.dataset.topic === activeId;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  });
}

function rerenderContent(contentHost: HTMLElement, state: PanelState, onChange: () => void): void {
  contentHost.innerHTML = '';
  if (state.status === 'loading') {
    contentHost.appendChild(buildLoading());
    return;
  }
  if (state.status === 'error') {
    contentHost.appendChild(buildError(state.errorMessage));
    return;
  }
  if (state.validationIssues?.length) {
    contentHost.appendChild(buildValidationBanner(state.validationIssues));
  }
  const topic = TOPICS.find((t) => t.id === state.activeTopic) ?? TOPICS[0];
  const ctx: TopicContext = { caps: state.caps, draft: state.draft, onChange };
  topic.render(contentHost, ctx);
}

function buildLoading(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sp-placeholder';
  wrap.innerHTML = `
    <i class="fa-solid fa-spinner fa-spin"></i>
    <p>Loading settings…</p>
  `;
  return wrap;
}

function buildError(message?: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sp-placeholder sp-error';
  wrap.innerHTML = `
    <i class="fa-solid fa-triangle-exclamation"></i>
    <p>Could not load settings.</p>
    ${message ? `<p class="sp-placeholder-sub">${escapeHtml(message)}</p>` : ''}
  `;
  return wrap;
}

function buildValidationBanner(issues: ValidationIssue[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sp-validation';
  wrap.innerHTML = `
    <strong><i class="fa-solid fa-circle-exclamation"></i> Server validation rejected the save</strong>
    <ul>${issues.map((i) => `<li><code>${escapeHtml(i.path)}</code>: ${escapeHtml(i.message)}</li>`).join('')}</ul>
  `;
  return wrap;
}

function isDirty(state: PanelState): boolean {
  return JSON.stringify(state.original) !== JSON.stringify(state.draft);
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
