import { context } from 'services/context';

import type { ProviderValue } from 'types/tmx';

export function setActiveProvider(provider: ProviderValue): void {
  context.provider = provider;
  updateProviderBranding();
}

export function clearActiveProvider(): void {
  context.provider = undefined;
  updateProviderBranding();
}

export function getActiveProvider(): ProviderValue | undefined {
  return context.provider;
}

function updateProviderBranding(): void {
  const el = document.getElementById('provider');
  if (!el) return;

  const provider = context.provider;
  if (provider?.organisationAbbreviation) {
    el.innerHTML = `<div style="font-size: .6em">${provider.organisationAbbreviation}</div>`;
    el.title = provider.organisationName || '';
  } else {
    el.innerHTML = `<div style="font-size: .6em">CF Admin</div>`;
    el.title = '';
  }
}
