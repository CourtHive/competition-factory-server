/**
 * Phase 3 — Provisioner caps editor.
 *
 * Modal launched from the provisioner workspace's provider list. Edits
 * `providerConfigCaps` for one provider and writes via
 * `PUT /provisioner/providers/:id/caps`. Per-field validation issues
 * (returned with `code: 'CAPS_INVALID'`) render inline below the form.
 */
import { updateProviderCapsAsProvisioner, getProviderAsProvisioner } from 'services/apis/provisionerWorkspaceApi';
import { openModal, closeModal } from 'components/modals/baseModal/baseModal';
import { tmxToast } from 'services/notifications/tmxToast';
import { t } from 'i18n';

import {
  appendIssues,
  buildCheckboxField,
  buildListField,
  buildNumberField,
  buildSectionHeader,
  buildTextField,
} from './providerConfigFormHelpers';
import {
  PERMISSION_GROUPS,
  type ProviderConfigCaps,
  type ValidationIssue,
} from 'types/providerConfig';

interface OpenCapsEditorParams {
  providerId: string;
  providerName?: string;
  onSaved?: () => void;
}

export function openCapsEditor({ providerId, providerName, onSaved }: OpenCapsEditorParams): void {
  // Fetch the current caps so the editor is pre-populated.
  getProviderAsProvisioner(providerId).then(
    (res: any) => {
      const caps: ProviderConfigCaps = res?.data?.providerConfigCaps ?? {};
      renderEditor({ providerId, providerName, caps, onSaved });
    },
    () => tmxToast({ message: t('system.loadError'), intent: 'is-danger' }),
  );
}

function renderEditor({
  providerId,
  providerName,
  caps,
  onSaved,
}: {
  providerId: string;
  providerName?: string;
  caps: ProviderConfigCaps;
  onSaved?: () => void;
}): void {
  // Per-field readers — populated by the field builders, drained on save.
  const boolReaders: Record<string, () => boolean> = {};
  const stringReaders: Record<string, () => string> = {};
  const numberReaders: Record<string, () => number | undefined> = {};
  const listReaders: Record<string, () => string[]> = {};

  let issuesContainer: HTMLElement | undefined;

  const content = (elem: HTMLElement) => {
    elem.style.cssText =
      'display: flex; flex-direction: column; gap: 6px; max-height: 60vh; overflow-y: auto; padding-right: 8px;';

    // ── Branding ──
    elem.appendChild(buildSectionHeader(t('providerConfig.section.branding')));
    elem.appendChild(
      buildTextField({
        label: t('providerConfig.branding.appName'),
        value: caps.branding?.appName ?? '',
        placeholder: 'TMX',
        registry: stringReaders,
        registryKey: 'branding.appName',
      }),
    );
    elem.appendChild(
      buildTextField({
        label: t('providerConfig.branding.navbarLogoUrl'),
        value: caps.branding?.navbarLogoUrl ?? '',
        placeholder: 'https://… or data:image/…',
        registry: stringReaders,
        registryKey: 'branding.navbarLogoUrl',
      }),
    );
    elem.appendChild(
      buildTextField({
        label: t('providerConfig.branding.navbarLogoAlt'),
        value: caps.branding?.navbarLogoAlt ?? '',
        registry: stringReaders,
        registryKey: 'branding.navbarLogoAlt',
      }),
    );
    elem.appendChild(
      buildNumberField({
        label: t('providerConfig.branding.navbarLogoHeight'),
        value: caps.branding?.navbarLogoHeight,
        registry: numberReaders,
        registryKey: 'branding.navbarLogoHeight',
      }),
    );
    elem.appendChild(
      buildTextField({
        label: t('providerConfig.branding.splashLogoUrl'),
        value: caps.branding?.splashLogoUrl ?? '',
        registry: stringReaders,
        registryKey: 'branding.splashLogoUrl',
      }),
    );
    elem.appendChild(
      buildTextField({
        label: t('providerConfig.branding.accentColor'),
        value: caps.branding?.accentColor ?? '',
        placeholder: '#0066cc',
        registry: stringReaders,
        registryKey: 'branding.accentColor',
      }),
    );

    // ── Permission ceilings ──
    elem.appendChild(buildSectionHeader(t('providerConfig.section.permissionCeilings')));
    const hint = document.createElement('div');
    hint.style.cssText = 'font-size: .75rem; color: var(--tmx-text-muted, #888); margin-bottom: 6px;';
    hint.textContent = t('providerConfig.permissions.ceilingHint');
    elem.appendChild(hint);

    for (const group of PERMISSION_GROUPS) {
      const groupHeader = document.createElement('div');
      groupHeader.style.cssText = 'margin: 8px 0 2px; font-size: .8rem; font-weight: 600;';
      groupHeader.textContent = group.label;
      elem.appendChild(groupHeader);
      for (const key of group.keys) {
        const currentValue = (caps.permissions as any)?.[key];
        elem.appendChild(
          buildCheckboxField({
            label: String(key),
            checked: currentValue === undefined ? true : !!currentValue,
            registry: boolReaders,
            registryKey: `permissions.${key}`,
          }),
        );
      }
    }

    // ── Allowed universes ──
    elem.appendChild(buildSectionHeader(t('providerConfig.section.allowedUniverses')));
    const universeHint = document.createElement('div');
    universeHint.style.cssText = 'font-size: .75rem; color: var(--tmx-text-muted, #888); margin-bottom: 6px;';
    universeHint.textContent = t('providerConfig.allowed.universeHint');
    elem.appendChild(universeHint);

    elem.appendChild(
      buildListField({
        label: 'allowedDrawTypes',
        values: caps.permissions?.allowedDrawTypes ?? [],
        placeholder: 'SE, RR, PAGE',
        registry: listReaders,
        registryKey: 'permissions.allowedDrawTypes',
      }),
    );
    elem.appendChild(
      buildListField({
        label: 'allowedCreationMethods',
        values: caps.permissions?.allowedCreationMethods ?? [],
        placeholder: 'AUTOMATED, MANUAL, DRAFT',
        registry: listReaders,
        registryKey: 'permissions.allowedCreationMethods',
      }),
    );
    elem.appendChild(
      buildListField({
        label: 'allowedScoringApproaches',
        values: caps.permissions?.allowedScoringApproaches ?? [],
        registry: listReaders,
        registryKey: 'permissions.allowedScoringApproaches',
      }),
    );
    elem.appendChild(
      buildListField({
        label: 'allowedMatchUpFormats',
        values: caps.policies?.allowedMatchUpFormats ?? [],
        placeholder: 'SET3-S:6/TB7, SET5-S:6/TB7',
        registry: listReaders,
        registryKey: 'policies.allowedMatchUpFormats',
      }),
    );

    // ── Integrations ──
    elem.appendChild(buildSectionHeader(t('providerConfig.section.integrations')));
    elem.appendChild(
      buildTextField({
        label: 'ssoProvider',
        value: caps.integrations?.ssoProvider ?? '',
        placeholder: 'ioncourt',
        registry: stringReaders,
        registryKey: 'integrations.ssoProvider',
      }),
    );

    issuesContainer = document.createElement('div');
    issuesContainer.style.cssText = 'margin-top: 8px;';
    elem.appendChild(issuesContainer);
  };

  openModal({
    title: providerName
      ? t('providerConfig.editCapsTitle', { name: providerName })
      : t('providerConfig.editCapsTitleGeneric'),
    content,
    config: { padding: '.75', maxWidth: 640 },
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      {
        label: t('common.save'),
        intent: 'is-primary',
        // Note: not auto-closing — we want the issues to surface inline if the
        // server rejects on validation.
        onClick: () => {
          const caps = collectCaps({ boolReaders, stringReaders, numberReaders, listReaders });
          updateProviderCapsAsProvisioner(providerId, caps).then(
            (res: any) => {
              if (res?.data?.code === 'CAPS_INVALID') {
                if (issuesContainer) appendIssues(issuesContainer, res.data.issues as ValidationIssue[]);
                tmxToast({ message: t('providerConfig.invalid'), intent: 'is-danger' });
                return;
              }
              if (res?.data?.error) {
                tmxToast({ message: res.data.error, intent: 'is-danger' });
                return;
              }
              tmxToast({ message: t('providerConfig.capsSaved'), intent: 'is-success' });
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

function collectCaps({
  boolReaders,
  stringReaders,
  numberReaders,
  listReaders,
}: {
  boolReaders: Record<string, () => boolean>;
  stringReaders: Record<string, () => string>;
  numberReaders: Record<string, () => number | undefined>;
  listReaders: Record<string, () => string[]>;
}): ProviderConfigCaps {
  const branding: any = {};
  for (const key of [
    'appName',
    'navbarLogoUrl',
    'navbarLogoAlt',
    'splashLogoUrl',
    'accentColor',
  ] as const) {
    const v = stringReaders[`branding.${key}`]?.();
    if (v && v.length > 0) branding[key] = v;
  }
  const navbarLogoHeight = numberReaders['branding.navbarLogoHeight']?.();
  if (navbarLogoHeight !== undefined) branding.navbarLogoHeight = navbarLogoHeight;

  const permissions: any = {};
  for (const [key, reader] of Object.entries(boolReaders)) {
    if (!key.startsWith('permissions.')) continue;
    permissions[key.slice('permissions.'.length)] = reader();
  }
  for (const arrayKey of ['allowedDrawTypes', 'allowedCreationMethods', 'allowedScoringApproaches'] as const) {
    const list = listReaders[`permissions.${arrayKey}`]?.() ?? [];
    if (list.length > 0) permissions[arrayKey] = list;
  }

  const policies: any = {};
  const matchUpFormats = listReaders['policies.allowedMatchUpFormats']?.() ?? [];
  if (matchUpFormats.length > 0) policies.allowedMatchUpFormats = matchUpFormats;

  const integrations: any = {};
  const ssoProvider = stringReaders['integrations.ssoProvider']?.();
  if (ssoProvider && ssoProvider.length > 0) integrations.ssoProvider = ssoProvider;

  const out: ProviderConfigCaps = {};
  if (Object.keys(branding).length > 0) out.branding = branding;
  if (Object.keys(permissions).length > 0) out.permissions = permissions;
  if (Object.keys(policies).length > 0) out.policies = policies;
  if (Object.keys(integrations).length > 0) out.integrations = integrations;
  return out;
}
