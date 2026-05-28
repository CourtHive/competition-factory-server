import { modifyUser, adminResendVerification } from 'services/apis/servicesApi';
import { renderForm } from 'courthive-components';
import { labelWithRoleTip } from './roleDefinitions';
import { buildUserProvidersPanel } from './userProvidersPanel';
import { getLoginState } from 'services/authentication/loginState';
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
  // Legacy `providerId` is still pinned to the user record for back-compat
  // with the modifyUser endpoint. The multi-provider Providers panel
  // (added below the form) now manages the canonical user_providers
  // associations; this scalar will be retired in Phase 5.
  const values = { providerId: user?.providerId || '' };
  const userId = user?.userId || user?.user_id || '';

  const content = (elem) => {
    inputs = renderForm(elem, [
      {
        iconLeft: 'fa-regular fa-envelope',
        value: user?.email || '',
        label: t('email'),
        field: 'email',
        disabled: true,
      },
      {
        iconLeft: 'fa-regular fa-shield-check',
        value: user?.contactEmail || '',
        label: t('recoveryEmail'),
        field: 'contactEmail',
      },
      // Anchor row — verification status badge + Send-verification button is
      // injected here post-render so we can manage state outside renderForm's
      // input model (the badge is read-only, not a form field).
      { text: '', id: 'recoveryEmailStatusAnchor' },
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
      // Anchor row — the multi-provider panel is injected here in the
      // content callback below. Empty `text` keeps the renderForm flow
      // happy without rendering anything visible.
      {
        text: '',
        id: 'editProvidersAnchor',
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
    ]);

    // Inject the multi-provider associations panel at the anchor row.
    // The server filters list responses by editor scope, so SUPER_ADMIN
    // sees every association the user has and PROVIDER_ADMIN editors
    // see only rows at their own provider(s). Skipped entirely if the
    // user record has no userId (legacy data) — the panel needs the
    // UUID to call the endpoints.
    if (userId) {
      const editorRoles = getLoginState()?.roles ?? [];
      const anchor = document.getElementById('editProvidersAnchor');
      const panel = buildUserProvidersPanel({ userId, editorRoles, providers });
      anchor?.replaceWith(panel);
    }

    const statusAnchor = document.getElementById('recoveryEmailStatusAnchor');
    if (statusAnchor) statusAnchor.replaceWith(buildRecoveryEmailStatus(user));
  };

  const roles = ['client', 'admin', 'score', 'developer', 'generate', 'director', 'official'];
  const permissions = ['devMode', 'editTennisId', 'deleteTournament'];
  const services = ['tournamentProfile'];

  const submitEdit = () => {
    const email = user?.email;
    const providerId = values.providerId || inputs.providerId?.value;
    const userRolesSelected = roles.map((role) => inputs[role]?.checked && role).filter(Boolean);
    const userPermsSelected = permissions.map((perm) => inputs[perm]?.checked && perm).filter(Boolean);
    const userServicesSelected = services.map((svc) => inputs[svc]?.checked && svc).filter(Boolean);
    const contactEmail = (inputs.contactEmail?.value ?? '').trim();

    modifyUser({
      email,
      providerId,
      roles: userRolesSelected,
      permissions: userPermsSelected,
      services: userServicesSelected,
      contactEmail,
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

export function buildRecoveryEmailStatus(user: any): HTMLElement {
  const row = document.createElement('div');
  row.className = 'recovery-email-status';
  row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:4px 0 12px 32px;font-size:13px;flex-wrap:wrap;';

  const hasContactEmail = !!user?.contactEmail;
  const verifiedAt = user?.emailVerifiedAt;

  const badge = document.createElement('span');
  badge.style.cssText =
    'display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:10px;font-weight:500;border:1px solid transparent;';
  if (!hasContactEmail) {
    badge.textContent = t('noRecoveryEmail');
    badge.style.background = 'var(--tmx-bg-secondary)';
    badge.style.color = 'var(--tmx-text-muted)';
    badge.style.borderColor = 'var(--tmx-border-secondary)';
  } else if (verifiedAt) {
    const date = new Date(verifiedAt).toLocaleDateString();
    badge.innerHTML =
      `<i class="fa-solid fa-circle-check" style="color:var(--tmx-status-success);"></i> ${t('verified')} ` +
      `<span style="color:var(--tmx-text-muted);font-weight:400;">${date}</span>`;
    badge.style.background = 'var(--tmx-panel-green-bg)';
    badge.style.color = 'var(--tmx-text-primary)';
    badge.style.borderColor = 'var(--tmx-panel-green-border)';
  } else {
    badge.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="color:var(--tmx-accent-orange);"></i> ${t('unverified')}`;
    badge.style.background = 'var(--tmx-panel-yellow-bg)';
    badge.style.color = 'var(--tmx-text-primary)';
    badge.style.borderColor = 'var(--tmx-panel-yellow-border)';
  }
  row.appendChild(badge);

  if (hasContactEmail && !verifiedAt) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t('sendVerification');
    button.style.cssText =
      'padding:4px 10px;border:1px solid var(--tmx-border-primary);border-radius:4px;' +
      'background:var(--tmx-bg-elevated);color:var(--tmx-text-primary);cursor:pointer;font-size:12px;';
    button.addEventListener('click', () => {
      button.disabled = true;
      const original = button.textContent;
      button.textContent = '…';
      adminResendVerification({ email: user.email })
        .then((res: any) => {
          const status = res?.status;
          const message = status === 'already_verified'
            ? t('alreadyVerified')
            : status === 'no_contact_email'
              ? t('noRecoveryEmail')
              : t('verificationSent');
          tmxToast({ message, intent: status === 'pending_verification' ? 'is-success' : 'is-warning' });
        })
        .catch((err: any) => {
          tmxToast({ message: err?.message ?? 'Failed to send verification', intent: 'is-danger' });
        })
        .finally(() => {
          button.disabled = false;
          button.textContent = original;
        });
    });
    row.appendChild(button);
  }

  const help = document.createElement('span');
  help.style.cssText = 'margin-left:auto;color:var(--tmx-text-muted);font-size:11px;';
  help.textContent = t('recoveryEmailHelp');
  row.appendChild(help);

  return row;
}
