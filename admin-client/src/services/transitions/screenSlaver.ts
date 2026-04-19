/**
 * Screen state management for admin app content areas.
 * Controls visibility of the admin and system page containers.
 */
import { NONE, TMX_ADMIN, TMX_SYSTEM, TMX_SANCTIONING, TMX_SYNC } from 'constants/tmxConstants';

let content: string | undefined;

const PAGE_IDS = [TMX_SYSTEM, TMX_ADMIN, TMX_SANCTIONING, TMX_SYNC];

function selectDisplay(which: string): void {
  for (const id of PAGE_IDS) {
    const el = document.getElementById(id);
    if (el) el.style.display = id === which ? 'flex' : 'none';
  }

  // Update homenav active states
  const systemIcon = document.getElementById('h-system');
  const adminIcon = document.getElementById('h-admin');
  if (systemIcon) {
    systemIcon.classList.toggle('active', which === TMX_SYSTEM);
  }
  if (adminIcon) {
    adminIcon.classList.toggle('active', which === TMX_ADMIN);
  }
  const sanctioningIcon = document.getElementById('h-sanctioning');
  if (sanctioningIcon) {
    sanctioningIcon.classList.toggle('active', which === TMX_SANCTIONING);
  }
  const syncIcon = document.getElementById('h-sync');
  if (syncIcon) {
    syncIcon.classList.toggle('active', which === TMX_SYNC);
  }
}

export const contentEquals = (what?: string): boolean => {
  return what ? what === content : !!content;
};

export const showTMXadmin = (): void => {
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = 'Admin';
  content = TMX_ADMIN;
  selectDisplay(content);
};

export const showTMXsanctioning = (): void => {
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = 'Sanctioning';
  content = TMX_SANCTIONING;
  selectDisplay(content);
};

export const showTMXsystem = (): void => {
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = 'System';
  content = TMX_SYSTEM;
  selectDisplay(content);
};

export const showTMXsync = (): void => {
  const titleEl = document.getElementById('pageTitle');
  if (titleEl) titleEl.textContent = 'Tournament Sync';
  content = TMX_SYNC;
  selectDisplay(content);
};
