import { validators, renderForm } from 'courthive-components';
import { adminCreateUser } from 'services/authentication/authApi';
import { getLoginState } from 'services/authentication/loginState';
import { tmxToast } from 'services/notifications/tmxToast';
import { labelWithRoleTip } from './roleDefinitions';
import { copyClick } from 'services/dom/copyClick';
import { openModal } from './baseModal/baseModal';
import { SUPER_ADMIN } from 'constants/tmxConstants';
import { isFunction } from 'functions/typeOf';
import { t } from 'i18n';

// Mirrors resetPasswordModal.generatePassword(): unambiguous alphanumeric
// set (no 0/O/1/l/I) so admins reading the value over a call don't get
// tripped up. 12 chars matches the server-side default.
function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let result = '';
  for (let i = 0; i < 12; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export function createUserModal(callback, providers = [], selectedProviderId?: string) {
  // Provider-admin creating users get their own provider pre-filled and
  // locked — they can't create users into a provider they don't admin.
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
  let modalHandle: any;

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
    modalHandle?.setButtonState('createUser', { disabled: !isValid });
  };

  const relationships = [
    {
      onInput: enableSubmit,
      control: 'email',
    },
  ];

  const initialPassword = generatePassword();

  const content = (elem) =>
    (inputs = renderForm(
      elem,
      [
        {
          iconLeft: 'fa-regular fa-envelope',
          placeholder: 'login id (often an email, not required to be one)',
          validator: validators.emailValidator,
          autocomplete: 'off',
          label: t('modals.createUser.loginEmail'),
          field: 'email',
        },
        // Optional contact email — when provided AND deliverable, the
        // server emails the new user a "Welcome, set your password" link
        // and the clipboard-handoff is suppressed. When left blank, the
        // existing clipboard flow runs as before.
        {
          iconLeft: 'fa-solid fa-paper-plane',
          placeholder: 'you@example.com (optional)',
          autocomplete: 'off',
          label: t('modals.createUser.contactEmail'),
          field: 'contactEmail',
        },
        // Password field — pre-filled with a generated 12-char password.
        // Admin can edit, regenerate, or copy. Server-side will also
        // generate one if the field is left empty (defensive double-fill).
        // Ignored when contactEmail is set: the user will set their own
        // password via the email link.
        {
          value: initialPassword,
          label: t('modals.createUser.password'),
          field: 'password',
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
        // and the field disabled — they cannot create users into a provider
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
        // user_providers row will be set to.
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

  const submitCreate = () => {
    const email = inputs.email.value;
    const password = (inputs.password?.value || '').trim() || undefined;
    const contactEmail = (inputs.contactEmail?.value || '').trim() || undefined;
    const providerId = values.providerId || inputs.providerId?.value || undefined;
    const providerRole = (inputs.providerRole?.value === 'PROVIDER_ADMIN'
      ? 'PROVIDER_ADMIN'
      : 'DIRECTOR') as 'PROVIDER_ADMIN' | 'DIRECTOR';
    const userPermissions = permissions.map((permission) => inputs[permission].checked && permission).filter(Boolean);
    const userServices = services.map((service) => inputs[service].checked && service).filter(Boolean);
    const userRoles = roles.map((role) => inputs[role].checked && role).filter(Boolean);

    const response = (res) => {
      const data = res?.data ?? {};

      if (!data?.success) {
        const errMessage = data.error || data.message;
        tmxToast({ message: errMessage || t('modals.createUser.failed'), intent: 'is-danger' });
      } else if (data.mode === 'email-sent') {
        // Server already emailed the new user a "set your password" link.
        // No password to clipboard — the user picks their own.
        tmxToast({
          message: t('modals.createUser.successEmailed', {
            email: data.contactEmail || contactEmail || '',
          }),
          intent: 'is-success',
        });
      } else if (data?.password) {
        // Classic clipboard handoff — server didn't email (no contactEmail
        // given, or its email send failed and the server fell back).
        copyClick(data.password);
        tmxToast({
          message: t('modals.createUser.successCopied', { email: data.email || email }),
          intent: 'is-success',
        });
      } else {
        // Defensive: success: true but neither mode signal we understand —
        // surface a generic confirmation rather than silently doing nothing.
        tmxToast({
          message: t('modals.createUser.successPlain', { email: data.email || email }),
          intent: 'is-success',
        });
      }

      if (isFunction(callback)) callback(res);
    };

    adminCreateUser({
      email,
      password,
      contactEmail,
      providerId,
      providerRole,
      roles: userRoles as string[],
      permissions: userPermissions as string[],
      services: userServices as string[],
    }).then(response, (err) => {
      const status = err?.response?.status;
      const message = err?.response?.data?.message || err?.message;
      if (status === 409) {
        tmxToast({
          message: t('modals.createUser.emailExists', { email }),
          intent: 'is-danger',
        });
      } else {
        tmxToast({ message: message || t('modals.createUser.failed'), intent: 'is-danger' });
      }
    });
  };

  modalHandle = openModal({
    title: t('modals.createUser.title'),
    content,
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      { label: t('modals.createUser.create'), intent: 'is-primary', id: 'createUser', disabled: true, onClick: submitCreate, close: true },
    ],
  });
}
