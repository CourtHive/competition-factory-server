import { validators, renderForm } from 'courthive-components';
import { inviteUser } from 'services/authentication/authApi';
import { getLoginState } from 'services/authentication/loginState';
import { tmxToast } from 'services/notifications/tmxToast';
import { labelWithRoleTip } from './roleDefinitions';
import { copyClick } from 'services/dom/copyClick';
import { openModal } from './baseModal/baseModal';
import { INVITE, SUPER_ADMIN } from 'constants/tmxConstants';
import { isFunction } from 'functions/typeOf';
import { t } from 'i18n';

/**
 * Build the accept-invite URL the invitee should follow to register.
 * Mirrors the route registered in `router/router.ts`:
 *   router.on(`/${INVITE}/:inviteKey`, registrationModal)
 *
 * Strips a trailing '/' from pathname so a root-mounted app produces
 * `https://host/#/invite/<code>` instead of `https://host//#/invite/<code>`.
 */
export function buildInviteUrl(inviteCode: string): string {
  const { origin, pathname } = globalThis.location;
  const base = pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  return `${origin}${base}/#/${INVITE}/${inviteCode}`;
}

export function inviteModal(callback, providers = [], selectedProviderId?: string) {
  // Provider-admin inviting users get their own provider pre-filled and
  // locked — they can't invite users into a provider they don't admin.
  // Super-admins choose freely.
  const editor = getLoginState();
  const editorIsSuperAdmin = !!editor?.roles?.includes(SUPER_ADMIN);
  const editorProviderId = editor?.providerId || '';

  const effectiveProviderId = editorIsSuperAdmin
    ? selectedProviderId || ''
    : editorProviderId || selectedProviderId || '';

  const noProvider: any = { value: { organisationName: 'None' }, key: '' };
  const providerList = [noProvider, ...providers].map(({ key, value }) => ({
    label: value?.organisationName,
    value: key,
  }));
  let inputs;

  const values = {
    providerId: effectiveProviderId,
    providerRole: 'DIRECTOR' as 'PROVIDER_ADMIN' | 'DIRECTOR',
  };
  const initialProviderLabel = effectiveProviderId
    ? providerList.find((p) => p.value === effectiveProviderId)?.label || effectiveProviderId
    : '';

  const setProviderId = (value) => (values.providerId = value);

  const enableSubmit = ({ inputs }) => {
    const value = inputs['email'].value;
    const isValid = validators.emailValidator(value);
    const inviteButton: any = document.getElementById('inviteUser');
    if (inviteButton) inviteButton.disabled = !isValid;
  };

  const relationships = [
    {
      onInput: enableSubmit,
      control: 'email',
    },
  ];

  const content = (elem) =>
    (inputs = renderForm(
      elem,
      [
        {
          iconLeft: 'fa-regular fa-envelope',
          placeholder: 'valid@email.com',
          validator: validators.emailValidator,
          autocomplete: 'off',
          label: t('email'),
          field: 'email',
        },
        {
          text: t('modals.inviteUser.roles'),
          header: true,
        },
        {
          label: labelWithRoleTip(t('modals.inviteUser.client'), 'client'),
          field: 'client',
          checkbox: true,
          width: '50%',
          id: 'client',
          fieldPair: {
            label: labelWithRoleTip(t('modals.inviteUser.director'), 'director'),
            field: 'director',
            id: 'director',
            checkbox: true,
          },
        },
        {
          label: labelWithRoleTip(t('modals.inviteUser.admin'), 'admin'),
          checkbox: true,
          field: 'admin',
          width: '50%',
          id: 'admin',
          fieldPair: {
            label: labelWithRoleTip(t('modals.inviteUser.official'), 'official'),
            field: 'official',
            id: 'official',
            checkbox: true,
          },
        },
        {
          label: labelWithRoleTip(t('modals.inviteUser.scoring'), 'score'),
          field: 'score',
          width: '50%',
          id: 'score',
          checkbox: true,
          fieldPair: {
            label: labelWithRoleTip(t('modals.inviteUser.developer'), 'developer'),
            field: 'developer',
            id: 'developer',
            checkbox: true,
          },
        },
        {
          label: labelWithRoleTip(t('modals.inviteUser.generate'), 'generate'),
          field: 'generate',
          checkbox: true,
          id: 'generate',
        },
        // Super-admins pick any provider via typeahead; everyone else
        // (PROVIDER_ADMIN / PROVISIONER) gets their own provider pre-filled
        // and the field disabled — they cannot invite users into a provider
        // they don't administer. The server enforces this regardless via
        // assertProviderEditor.
        editorIsSuperAdmin
          ? {
              typeAhead: { list: providerList, callback: setProviderId },
              value: initialProviderLabel || values.providerId || '',
              placeholder: t('none'),
              field: 'providerId',
              label: t('modals.inviteUser.provider'),
            }
          : {
              value: initialProviderLabel,
              field: 'providerId',
              label: t('modals.inviteUser.provider'),
              disabled: true,
            },
        // Provider-scope role at the chosen provider — what the new user's
        // user_providers row will be set to on accept (for new emails) or
        // upserted as right now (for existing emails).
        {
          options: [
            { label: 'DIRECTOR', value: 'DIRECTOR' },
            { label: 'PROVIDER_ADMIN', value: 'PROVIDER_ADMIN' },
          ],
          value: values.providerRole,
          field: 'providerRole',
          label: t('modals.inviteUser.providerRole'),
        },
        {
          text: t('modals.inviteUser.permissions'),
          header: true,
        },
        {
          label: t('modals.inviteUser.deleteTournaments'),
          field: 'deleteTournament',
          checkbox: true,
          id: 'delete',
        },
        {
          field: 'editTennisId',
          label: t('modals.inviteUser.editWtid'),
          id: 'editTennisId',
          checkbox: true,
        },
        {
          label: t('modals.inviteUser.devMode'),
          field: 'devMode',
          checkbox: true,
          id: 'devmode',
        },
        {
          text: t('modals.inviteUser.services'),
          header: true,
        },
        {
          label: t('modals.inviteUser.tournamentProfiles'),
          field: 'tournamentProfile',
          id: 'tournamentProfile',
          checkbox: true,
        },
      ],
      relationships,
    ));

  const roles = ['client', 'admin', 'score', 'developer', 'generate', 'director', 'official'];
  const permissions = ['devMode', 'editTennisId', 'deleteTournament'];
  const services = ['tournamentProfile'];
  const submitInvite = () => {
    const email = inputs.email.value;
    const providerId = values.providerId || inputs.providerId?.value;
    const providerRole = (inputs.providerRole?.value === 'PROVIDER_ADMIN'
      ? 'PROVIDER_ADMIN'
      : 'DIRECTOR') as 'PROVIDER_ADMIN' | 'DIRECTOR';
    const userPermissions = permissions.map((permission) => inputs[permission].checked && permission).filter(Boolean);
    const userServices = services.map((service) => inputs[service].checked && service).filter(Boolean);
    const userRoles = roles.map((role) => inputs[role].checked && role).filter(Boolean);

    const response = (res) => {
      const data = res?.data ?? {};

      // Two server response shapes:
      //   { existingUser: true, providerId, providerRole } — email already
      //     exists; server upserted user_providers row directly. No invite
      //     code, nothing to copy. Toast and close.
      //   { existingUser: false, inviteCode }  — new user. Build accept URL
      //     and copy to clipboard.
      if (data.existingUser) {
        const providerLabel =
          providerList.find((p) => p.value === data.providerId)?.label || data.providerId;
        tmxToast({
          message: t('modals.inviteUser.existingUserAdded', {
            email,
            provider: providerLabel,
            role: data.providerRole,
          }),
          intent: 'is-success',
        });
      } else if (data.inviteCode) {
        const inviteURL = buildInviteUrl(data.inviteCode);
        console.log('Invite URL:', inviteURL);
        copyClick(inviteURL);
      } else {
        const errMessage = data.error || data.message;
        console.warn('Invite failed — no inviteCode in response:', data);
        tmxToast({ message: errMessage || t('system.inviteFailed'), intent: 'is-danger' });
      }

      if (isFunction(callback)) callback(res);
    };

    inviteUser(email, providerId, userRoles, userPermissions, userServices, providerRole).then(
      response,
      (err) => {
        console.warn('[inviteModal] inviteUser failed', err);
        tmxToast({ message: err?.message || t('system.inviteFailed'), intent: 'is-danger' });
      },
    );
  };

  openModal({
    title: t('modals.inviteUser.title'),
    content,
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      { label: t('modals.inviteUser.invite'), intent: 'is-primary', id: 'inviteUser', disabled: true, onClick: submitInvite, close: true },
    ],
  });
}
