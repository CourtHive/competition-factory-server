/**
 * Provider settings panel — full-width in-page editor that replaces
 * the old Quick Actions → Edit Settings modal. Two-column layout:
 * topic nav on the left, structured editor on the right. Persists to
 * `providerConfigSettings` via the existing `updateProviderSettings`
 * API.
 *
 * Phase 1: layout + topic nav skeleton.
 * Phase 2 (this): fetch raw config on mount, switch content per topic
 *   via the registry in `topics.ts`, render read-only summaries.
 * Phase 3: per-topic editors (multi-select chips, structured policy
 *   forms, embedded composition editor, etc.).
 *
 * See `Mentat/planning/ADMIN_SETTINGS_PAGE_REDESIGN.md`.
 */
import './settingsPanel.css';
import { getRawProviderConfig } from 'services/apis/providerConfigApi';
import { tmxToast } from 'services/notifications/tmxToast';
import { t } from 'i18n';
import type { ProviderValue } from 'types/tmx';
import type { ProviderConfigCaps, ProviderConfigSettings } from 'types/providerConfig';
import { TOPICS, type TopicContext, type TopicId } from './topics';

interface RenderSettingsPanelParams {
  provider: ProviderValue;
  isSuperAdmin?: boolean;
}

interface PanelState {
  status: 'loading' | 'ready' | 'error';
  caps: ProviderConfigCaps;
  settings: ProviderConfigSettings;
  activeTopic: TopicId;
  errorMessage?: string;
}

export function renderSettingsPanel(grid: HTMLElement, params: RenderSettingsPanelParams): void {
  const panel = document.createElement('div');
  panel.className = 'settings-panel panel-gray sp-panel';
  panel.style.gridColumn = '1 / -1';
  panel.dataset.providerId = params.provider.organisationId;
  if (params.isSuperAdmin) panel.dataset.superAdmin = 'true';

  const header = document.createElement('h3');
  header.innerHTML = '<i class="fa-solid fa-sliders"></i> Settings';
  panel.appendChild(header);

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

  const state: PanelState = {
    status: 'loading',
    caps: {},
    settings: {},
    activeTopic: TOPICS[0].id,
  };

  buildNav(navHost, state, (next) => {
    state.activeTopic = next;
    rerenderContent(contentHost, state);
  });
  rerenderContent(contentHost, state);

  void loadConfig(params.provider.organisationId, state, () => {
    rerenderContent(contentHost, state);
    // Repaint nav so any per-topic indicators (configured/empty) reflect
    // freshly-loaded data once Phase 3 introduces them.
    navHost.querySelectorAll<HTMLButtonElement>('.sp-nav-item').forEach((btn) => {
      const isActive = btn.dataset.topic === state.activeTopic;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });
  });
}

async function loadConfig(providerId: string, state: PanelState, onChange: () => void): Promise<void> {
  try {
    const res: any = await getRawProviderConfig(providerId);
    if (res?.data?.error) {
      state.status = 'error';
      state.errorMessage = res.data.error;
    } else {
      state.caps = (res?.data?.caps ?? {}) as ProviderConfigCaps;
      state.settings = (res?.data?.settings ?? {}) as ProviderConfigSettings;
      state.status = 'ready';
    }
  } catch (err) {
    state.status = 'error';
    state.errorMessage = err instanceof Error ? err.message : t('system.loadError');
    tmxToast({ message: t('system.loadError'), intent: 'is-danger' });
  }
  onChange();
}

function buildNav(navHost: HTMLElement, state: PanelState, onSelect: (id: TopicId) => void): void {
  for (const topic of TOPICS) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'sp-nav-item';
    item.dataset.topic = topic.id;
    const isActive = topic.id === state.activeTopic;
    item.classList.toggle('is-active', isActive);
    item.setAttribute('aria-pressed', String(isActive));
    item.innerHTML = `<i class="fa-solid ${topic.icon}"></i><span>${topic.label}</span>`;
    item.addEventListener('click', () => onSelect(topic.id));
    navHost.appendChild(item);
  }
}

function rerenderContent(contentHost: HTMLElement, state: PanelState): void {
  contentHost.innerHTML = '';
  if (state.status === 'loading') {
    contentHost.appendChild(buildLoading());
    return;
  }
  if (state.status === 'error') {
    contentHost.appendChild(buildError(state.errorMessage));
    return;
  }
  const topic = TOPICS.find((t) => t.id === state.activeTopic) ?? TOPICS[0];
  const ctx: TopicContext = { caps: state.caps, settings: state.settings };
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

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
