import { modifyUser } from 'services/apis/servicesApi';
import { renderForm } from 'courthive-components';
import { labelWithRoleTip } from './roleDefinitions';
import { openModal } from './baseModal/baseModal';
import { tmxToast } from 'services/notifications/tmxToast';
import { isFunction } from 'functions/typeOf';
import { t } from 'i18n';

type EditUserModalParams = {
  user: any;
  providers?: any[];
  callback?: (res: any) => void;
};

export function editUserModal({ user, providers = [], callback }: EditUserModalParams): void {
  const userRoles = user?.roles || [];
  const userPermissions = user?.permissions || [];
  const userServices = user?.services || [];

  let inputs;
  const values = { providerId: user?.providerId || '' };

  // Legacy single-provider field. The new model assigns providers via the
  // user_providers many-to-many table; this column will be deprecated.
  // Show the organisation name in a disabled input rather than letting the
  // editor change it here — multi-provider edits will land in a separate
  // UI. Save flow still passes `values.providerId` through unchanged.
  const initialProvider = (providers || []).find((p) => p.key === values.providerId);
  const initialProviderDisplay =
    initialProvider?.value?.organisationName ?? (values.providerId || t('none'));

  const content = (elem) =>
    (inputs = renderForm(elem, [
      {
        iconLeft: 'fa-regular fa-envelope',
        value: user?.email || '',
        label: t('email'),
        field: 'email',
        disabled: true,
      },
      {
        text: t('modals.inviteUser.roles'),
        header: true,
      },
      {
        label: labelWithRoleTip(t('modals.inviteUser.client'), 'client'),
        checked: userRoles.includes('client'),
        field: 'client',
        checkbox: true,
        width: '50%',
        id: 'editClient',
        fieldPair: {
          label: labelWithRoleTip(t('modals.inviteUser.director'), 'director'),
          checked: userRoles.includes('director'),
          field: 'director',
          id: 'editDirector',
          checkbox: true,
        },
      },
      {
        label: labelWithRoleTip(t('modals.inviteUser.admin'), 'admin'),
        checked: userRoles.includes('admin'),
        checkbox: true,
        field: 'admin',
        width: '50%',
        id: 'editAdmin',
        fieldPair: {
          label: labelWithRoleTip(t('modals.inviteUser.official'), 'official'),
          checked: userRoles.includes('official'),
          field: 'official',
          id: 'editOfficial',
          checkbox: true,
        },
      },
      {
        label: labelWithRoleTip(t('modals.inviteUser.scoring'), 'score'),
        checked: userRoles.includes('score'),
        field: 'score',
        width: '50%',
        id: 'editScore',
        checkbox: true,
        fieldPair: {
          label: labelWithRoleTip(t('modals.inviteUser.developer'), 'developer'),
          checked: userRoles.includes('developer'),
          field: 'developer',
          id: 'editDeveloper',
          checkbox: true,
        },
      },
      {
        label: labelWithRoleTip(t('modals.inviteUser.generate'), 'generate'),
        checked: userRoles.includes('generate'),
        field: 'generate',
        checkbox: true,
        id: 'editGenerate',
      },
      {
        value: initialProviderDisplay,
        field: 'providerId',
        label: t('modals.inviteUser.provider'),
        disabled: true,
      },
      {
        text: t('modals.inviteUser.permissions'),
        header: true,
      },
      {
        // PROVIDER_ADMIN at the user's home provider implies delete authority
        // server-side, so when 'admin' is checked we auto-check + disable this
        // box to keep the UI honest. The relationship at the bottom of this
        // form handles the dynamic toggle.
        label: t('modals.inviteUser.deleteTournaments'),
        checked: userPermissions.includes('deleteTournament') || userRoles.includes('admin'),
        disabled: userRoles.includes('admin'),
        field: 'deleteTournament',
        checkbox: true,
        id: 'editDelete',
      },
      {
        field: 'editTennisId',
        label: t('modals.inviteUser.editWtid'),
        checked: userPermissions.includes('editTennisId'),
        id: 'editEditTennisId',
        checkbox: true,
      },
      {
        label: t('modals.inviteUser.devMode'),
        checked: userPermissions.includes('devMode'),
        field: 'devMode',
        checkbox: true,
        id: 'editDevmode',
      },
      {
        text: t('modals.inviteUser.services'),
        header: true,
      },
      {
        label: t('modals.inviteUser.tournamentProfiles'),
        checked: userServices.includes('tournamentProfile'),
        field: 'tournamentProfile',
        id: 'editTournamentProfile',
        checkbox: true,
      },
    ], [
      // When 'admin' (provider admin shorthand) is checked, force-check and
      // lock the deleteTournament permission — the server already grants
      // delete to PROVIDER_ADMIN scope, so an unchecked box would mislead
      // editors into thinking delete is blocked. Unchecking 'admin' unlocks
      // the permission box but doesn't auto-uncheck it (user can clear).
      {
        control: 'admin',
        onChange: ({ inputs: i }: any) => {
          const adminChecked = !!i.admin?.checked;
          if (i.deleteTournament) {
            if (adminChecked) {
              i.deleteTournament.checked = true;
              i.deleteTournament.disabled = true;
            } else {
              i.deleteTournament.disabled = false;
            }
          }
        },
      },
    ]));

  const roles = ['client', 'admin', 'score', 'developer', 'generate', 'director', 'official'];
  const permissions = ['devMode', 'editTennisId', 'deleteTournament'];
  const services = ['tournamentProfile'];

  const submitEdit = () => {
    const email = user?.email;
    const providerId = values.providerId || inputs.providerId?.value;
    const userRolesSelected = roles.map((role) => inputs[role]?.checked && role).filter(Boolean);
    const userPermsSelected = permissions.map((perm) => inputs[perm]?.checked && perm).filter(Boolean);
    const userServicesSelected = services.map((svc) => inputs[svc]?.checked && svc).filter(Boolean);

    modifyUser({
      email,
      providerId,
      roles: userRolesSelected,
      permissions: userPermsSelected,
      services: userServicesSelected,
    }).then(
      (res) => {
        tmxToast({ message: t('system.userUpdated'), intent: 'is-success' });
        if (isFunction(callback)) callback(res);
      },
      (err) => console.log({ err }),
    );
  };

  openModal({
    title: t('system.editUserTitle'),
    content,
    buttons: [
      { label: t('common.cancel'), intent: 'none', close: true },
      { label: t('common.save'), intent: 'is-primary', onClick: submitEdit, close: true },
    ],
  });
}
