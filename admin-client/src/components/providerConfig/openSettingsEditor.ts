/**
 * Phase 4 — Provider admin settings editor.
 *
 * Modal launched from the provider admin landing (`renderAdminGrid`).
 * Edits `providerConfigSettings` for the active provider and writes via
 * `PUT /provider/:id/settings`. Cap-aware UI:
 *
 *   - boolean ceilings disabled with a "locked by provisioner" tooltip
 *     where caps explicitly set the key to `false`
 *   - allowedX list fields show the provisioner-allowed universe as a
 *     hint above the input
 *   - branding + integrations sections are NOT shown — those tiers are
 *     provisioner-owned
 *
 * Reads the raw split via `GET /provider/:id/raw-config` (PROVIDER_ADMIN
 * or SUPER_ADMIN only). Per-field validation issues from
 * `code: 'SETTINGS_INVALID'` render inline below the form.
 */
import { getRawProviderConfig, updateProviderSettings } from 'services/apis/providerConfigApi';
import { openModal, closeModal } from 'components/modals/baseModal/baseModal';
import { tmxToast } from 'services/notifications/tmxToast';
import { t } from 'i18n';

import {
  appendIssues,
  buildCheckboxField,
  buildListField,
  buildSectionHeader,
  buildTextField,
} from './providerConfigFormHelpers';
import {
  PERMISSION_GROUPS,
  type ProviderConfigCaps,
  type ProviderConfigSettings,
  type ValidationIssue,
} from 'types/providerConfig';

interface OpenSettingsEditorParams {
  providerId: string;
  providerName?: string;
  onSaved?: () => void;
}

export function openSettingsEditor({ providerId, providerName, onSaved }: OpenSettingsEditorParams): void {
  getRawProviderConfig(providerId).then(
    (res: any) => {
      if (res?.data?.error) {
        tmxToast({ message: res.data.error, intent: 'is-danger' });
        return;
      }
      renderEditor({
        providerId,
        providerName,
        caps: (res?.data?.caps ?? {}) as ProviderConfigCaps,
        settings: (res?.data?.settings ?? {}) as ProviderConfigSettings,
        onSaved,
      });
    },
    () => tmxToast({ message: t('system.loadError'), intent: 'is-danger' }),
  );
}

function renderEditor({
  providerId,
  providerName,
  caps,
  settings,
  onSaved,
}: {
  providerId: string;
  providerName?: string;
  caps: ProviderConfigCaps;
  settings: ProviderConfigSettings;
  onSaved?: () => void;
}): void {
  const boolReaders: Record<string, () => boolean> = {};
  const stringReaders: Record<string, () => string> = {};
  const listReaders: Record<string, () => string[]> = {};
  const jsonReaders: Record<string, () => { value: any; error?: string }> = {};

  let issuesContainer: HTMLElement | undefined;

  const content = (elem: HTMLElement) => {
    elem.style.cssText =
      'display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow-y: auto; padding-right: 8px;';

    // ── Permissions (cap-aware) ──
    elem.appendChild(buildSectionHeader(t('providerConfig.section.permissionChoices')));
    const permHint = document.createElement('div');
    permHint.style.cssText = 'font-size: .75rem; color: var(--tmx-text-muted, #888); margin-bottom: 6px;';
    permHint.textContent = t('providerConfig.permissions.choiceHint');
    elem.appendChild(permHint);

    for (const group of PERMISSION_GROUPS) {
      const groupHeader = document.createElement('div');
      groupHeader.style.cssText = 'margin: 8px 0 2px; font-size: .8rem; font-weight: 600;';
      groupHeader.textContent = group.label;
      elem.appendChild(groupHeader);
      for (const key of group.keys) {
        const capForbids = (caps.permissions as any)?.[key] === false;
        const settingValue = (settings.permissions as any)?.[key];
        // When caps forbid, the effective value is always false. The settings
        // value still gets sent as-is on save (no auto-coerce — the validator
        // would reject any attempt to enable it anyway).
        const checked = capForbids ? false : settingValue === undefined ? true : !!settingValue;
        elem.appendChild(
          buildCheckboxField({
            label: String(key),
            checked,
            pinned: capForbids,
            pinnedReason: t('providerConfig.permissions.lockedByProvisioner'),
            registry: boolReaders,
            registryKey: `permissions.${key}`,
          }),
        );
      }
    }

    // ── Allowed selections (narrowing within caps) ──
    elem.appendChild(buildSectionHeader(t('providerConfig.section.allowedSelections')));
    const allowedHint = document.createElement('div');
    allowedHint.style.cssText = 'font-size: .75rem; color: var(--tmx-text-muted, #888); margin-bottom: 6px;';
    allowedHint.textContent = t('providerConfig.allowed.selectionHint');
    elem.appendChild(allowedHint);

    elem.appendChild(
      buildListField({
        label: 'allowedDrawTypes',
        values: settings.permissions?.allowedDrawTypes ?? [],
        registry: listReaders,
        registryKey: 'permissions.allowedDrawTypes',
        pinnedUniverse: caps.permissions?.allowedDrawTypes,
      }),
    );
    elem.appendChild(
      buildListField({
        label: 'allowedCreationMethods',
        values: settings.permissions?.allowedCreationMethods ?? [],
        registry: listReaders,
        registryKey: 'permissions.allowedCreationMethods',
        pinnedUniverse: caps.permissions?.allowedCreationMethods,
      }),
    );
    elem.appendChild(
      buildListField({
        label: 'allowedScoringApproaches',
        values: settings.permissions?.allowedScoringApproaches ?? [],
        registry: listReaders,
        registryKey: 'permissions.allowedScoringApproaches',
        pinnedUniverse: caps.permissions?.allowedScoringApproaches,
      }),
    );
    elem.appendChild(
      buildListField({
        label: 'allowedMatchUpFormats',
        values: settings.policies?.allowedMatchUpFormats ?? [],
        registry: listReaders,
        registryKey: 'policies.allowedMatchUpFormats',
        pinnedUniverse: caps.policies?.allowedMatchUpFormats,
      }),
    );

    // ── Policies (settings-only — JSON textareas) ──
    elem.appendChild(buildSectionHeader(t('providerConfig.section.policies')));
    elem.appendChild(
      buildJsonField({
        label: t('providerConfig.policies.schedulingPolicy'),
        value: settings.policies?.schedulingPolicy,
        registry: jsonReaders,
        registryKey: 'policies.schedulingPolicy',
      }),
    );
    elem.appendChild(
      buildJsonField({
        label: t('providerConfig.policies.scoringPolicy'),
        value: settings.policies?.scoringPolicy,
        registry: jsonReaders,
        registryKey: 'policies.scoringPolicy',
      }),
    );
    elem.appendChild(
      buildJsonField({
        label: t('providerConfig.policies.seedingPolicy'),
        value: settings.policies?.seedingPolicy,
        registry: jsonReaders,
        registryKey: 'policies.seedingPolicy',
      }),
    );

    // ── Defaults (settings-only) ──
    elem.appendChild(buildSectionHeader(t('providerConfig.section.defaults')));
    elem.appendChild(
      buildTextField({
        label: t('providerConfig.defaults.defaultEventType'),
        value: settings.defaults?.defaultEventType ?? '',
        placeholder: 'SINGLES',
        registry: stringReaders,
        registryKey: 'defaults.defaultEventType',
      }),
    );
    elem.appendChild(
      buildTextField({
        label: t('providerConfig.defaults.defaultDrawType'),
        value: settings.defaults?.defaultDrawType ?? '',
        placeholder: 'SE',
        registry: stringReaders,
        registryKey: 'defaults.defaultDrawType',
      }),
    );
    elem.appendChild(
      buildTextField({
        label: t('providerConfig.defaults.defaultCreationMethod'),
        value: settings.defaults?.defaultCreationMethod ?? '',
        placeholder: 'AUTOMATED',
        registry: stringReaders,
        registryKey: 'defaults.defaultCreationMethod',
      }),
    );
    elem.appendChild(
      buildTextField({
        label: t('providerConfig.defaults.defaultGender'),
        value: settings.defaults?.defaultGender ?? '',
        registry: stringReaders,
        registryKey: 'defaults.defaultGender',
      }),
    );

    issuesContainer = document.createElement('div');
    issuesContainer.style.cssText = 'margin-top: 8px;';
    elem.appendChild(issuesContainer);
  };

  openModal({
    title: providerName
      ? t('providerConfig.editSettingsTitle', { name: providerName })
      : t('providerConfig.editSettingsTitleGeneric'),
    content,
    config: { padding: '.75', maxWidth: 640 },
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      {
        label: t('common.save'),
        intent: 'is-primary',
        onClick: () => {
          const collectResult = collectSettings({ boolReaders, stringReaders, listReaders, jsonReaders, caps });
          if (collectResult.jsonErrors.length) {
            const fakeIssues: ValidationIssue[] = collectResult.jsonErrors.map((e) => ({
              path: e.path,
              code: 'wrongType',
              message: e.message,
            }));
            if (issuesContainer) appendIssues(issuesContainer, fakeIssues);
            tmxToast({ message: t('providerConfig.invalid'), intent: 'is-danger' });
            return;
          }
          updateProviderSettings(providerId, collectResult.settings).then(
            (res: any) => {
              if (res?.data?.code === 'SETTINGS_INVALID') {
                if (issuesContainer) appendIssues(issuesContainer, res.data.issues as ValidationIssue[]);
                tmxToast({ message: t('providerConfig.invalid'), intent: 'is-danger' });
                return;
              }
              if (res?.data?.error) {
                tmxToast({ message: res.data.error, intent: 'is-danger' });
                return;
              }
              tmxToast({ message: t('providerConfig.settingsSaved'), intent: 'is-success' });
              closeModal();
              onSaved?.();
            },
            () => tmxToast({ message: t('providerConfig.saveFailed'), intent: 'is-danger' }),
          );
        },
      },
    ],
  });
}

interface JsonFieldOptions {
  label: string;
  value: any;
  registry: Record<string, () => { value: any; error?: string }>;
  registryKey: string;
}

function buildJsonField(opts: JsonFieldOptions): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom: 8px;';

  const label = document.createElement('label');
  label.style.cssText = 'display: block; font-size: .8rem; color: var(--tmx-text-secondary, #555); margin-bottom: 2px;';
  label.textContent = opts.label;
  wrap.appendChild(label);

  const ta = document.createElement('textarea');
  ta.rows = 3;
  ta.placeholder = '{ ... }';
  ta.value = opts.value === undefined ? '' : JSON.stringify(opts.value, null, 2);
  ta.style.cssText =
    'width: 100%; padding: 4px 8px; border: 1px solid var(--tmx-border-primary, #ccc); border-radius: 4px; font-size: .8rem; font-family: monospace; background: var(--tmx-bg-elevated, #fff); color: var(--tmx-text-primary, #363636);';
  wrap.appendChild(ta);

  opts.registry[opts.registryKey] = () => {
    const raw = ta.value.trim();
    if (raw === '') return { value: undefined };
    try {
      return { value: JSON.parse(raw) };
    } catch {
      return { value: undefined, error: 'Invalid JSON' };
    }
  };
  return wrap;
}

function collectSettings({
  boolReaders,
  stringReaders,
  listReaders,
  jsonReaders,
  caps,
}: {
  boolReaders: Record<string, () => boolean>;
  stringReaders: Record<string, () => string>;
  listReaders: Record<string, () => string[]>;
  jsonReaders: Record<string, () => { value: any; error?: string }>;
  caps: ProviderConfigCaps;
}): { settings: ProviderConfigSettings; jsonErrors: { path: string; message: string }[] } {
  const jsonErrors: { path: string; message: string }[] = [];

  const permissions: any = {};
  for (const [key, reader] of Object.entries(boolReaders)) {
    if (!key.startsWith('permissions.')) continue;
    const permKey = key.slice('permissions.'.length);
    // If caps forbid, do not write a settings value — it would be rejected
    // by the server's caps-respect validator anyway. Skipping keeps the
    // settings blob lean.
    if ((caps.permissions as any)?.[permKey] === false) continue;
    permissions[permKey] = reader();
  }
  for (const arrayKey of ['allowedDrawTypes', 'allowedCreationMethods', 'allowedScoringApproaches'] as const) {
    const list = listReaders[`permissions.${arrayKey}`]?.() ?? [];
    if (list.length > 0) permissions[arrayKey] = list;
  }

  const policies: any = {};
  const matchUpFormats = listReaders['policies.allowedMatchUpFormats']?.() ?? [];
  if (matchUpFormats.length > 0) policies.allowedMatchUpFormats = matchUpFormats;

  for (const policyKey of ['schedulingPolicy', 'scoringPolicy', 'seedingPolicy'] as const) {
    const result = jsonReaders[`policies.${policyKey}`]?.();
    if (result?.error) {
      jsonErrors.push({ path: `policies.${policyKey}`, message: result.error });
      continue;
    }
    if (result?.value !== undefined) policies[policyKey] = result.value;
  }

  const defaults: any = {};
  for (const key of ['defaultEventType', 'defaultDrawType', 'defaultCreationMethod', 'defaultGender'] as const) {
    const v = stringReaders[`defaults.${key}`]?.();
    if (v && v.length > 0) defaults[key] = v;
  }

  const settings: ProviderConfigSettings = {};
  if (Object.keys(permissions).length > 0) settings.permissions = permissions;
  if (Object.keys(policies).length > 0) settings.policies = policies;
  if (Object.keys(defaults).length > 0) settings.defaults = defaults;
  return { settings, jsonErrors };
}
