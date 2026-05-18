type SearchInputParams = {
  placeholder?: string;
  value?: string;
  id?: string;
  onInput?: (value: string) => void;
  onChange?: (value: string) => void;
  onKeyDown?: (e: KeyboardEvent) => void;
  /** Called when user clicks the X or presses Escape. Receives the input. */
  onClear?: () => void;
  /** Min-width hint applied as inline style; defaults to 200px. */
  minWidth?: string;
};

type SearchInputHandle = {
  container: HTMLElement;
  input: HTMLInputElement;
  setValue: (value: string) => void;
  clear: () => void;
};

const MAGNIFIER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="14" height="14" fill="currentColor"><path d="M416 208c0 45.9-14.9 88.3-40 122.7L502.6 457.4c12.5 12.5 12.5 32.8 0 45.3s-32.8 12.5-45.3 0L330.7 376c-34.4 25.2-76.8 40-122.7 40C93.1 416 0 322.9 0 208S93.1 0 208 0S416 93.1 416 208zM208 352a144 144 0 1 0 0-288 144 144 0 1 0 0 288z"/></svg>';

const CLEAR_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="14" height="14" fill="currentColor"><path d="M256 512A256 256 0 1 0 256 0a256 256 0 1 0 0 512zM175 175c9.4-9.4 24.6-9.4 33.9 0l47 47 47-47c9.4-9.4 24.6-9.4 33.9 0s9.4 24.6 0 33.9l-47 47 47 47c9.4 9.4 9.4 24.6 0 33.9s-24.6 9.4-33.9 0l-47-47-47 47c-9.4 9.4-24.6 9.4-33.9 0s-9.4-24.6 0-33.9l47-47-47-47c-9.4-9.4-9.4-24.6 0-33.9z"/></svg>';

/**
 * Mirrors TMX's standard clearable search field (the controlBar `search: true`
 * pattern): magnifier-left + circle-X-right, where the X is only visible when
 * the input has a value. Escape clears as well. Uses the `.control` /
 * `.input` / `.icon` classes shipped by courthive-components so styling stays
 * consistent across the ecosystem.
 */
export function buildSearchInput(params: SearchInputParams = {}): SearchInputHandle {
  const container = document.createElement('p');
  container.className = 'control has-icons-left has-icons-right tmx-search-control';
  container.style.minWidth = params.minWidth ?? '200px';
  container.style.margin = '0';

  const input = document.createElement('input');
  input.className = 'input';
  input.type = 'text';
  input.autocomplete = 'off';
  input.placeholder = params.placeholder ?? '';
  if (params.id) input.id = params.id;
  if (params.value) input.value = params.value;

  const leftIcon = document.createElement('span');
  leftIcon.className = 'icon is-small is-left';
  leftIcon.style.color = 'var(--tmx-text-muted, #888)';
  leftIcon.innerHTML = MAGNIFIER_SVG;

  const clearIcon = document.createElement('span');
  clearIcon.className = 'icon is-small is-right';
  clearIcon.style.color = 'var(--tmx-text-muted, #888)';
  clearIcon.style.cursor = 'pointer';
  clearIcon.style.pointerEvents = 'all';
  clearIcon.setAttribute('role', 'button');
  clearIcon.setAttribute('aria-label', 'Clear search');
  clearIcon.innerHTML = CLEAR_SVG;

  const syncClearVisibility = () => {
    clearIcon.style.display = input.value ? '' : 'none';
  };

  const fireClear = () => {
    input.value = '';
    syncClearVisibility();
    params.onInput?.('');
    params.onChange?.('');
    params.onClear?.();
    input.focus();
  };

  input.addEventListener('input', (e: Event) => {
    syncClearVisibility();
    params.onInput?.((e.target as HTMLInputElement).value);
  });

  if (params.onChange) {
    input.addEventListener('change', (e: Event) => {
      params.onChange?.((e.target as HTMLInputElement).value);
    });
  }

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Escape' && input.value) {
      e.stopPropagation();
      fireClear();
      return;
    }
    params.onKeyDown?.(e);
  });

  clearIcon.addEventListener('click', (e: MouseEvent) => {
    e.stopPropagation();
    fireClear();
  });

  container.appendChild(input);
  container.appendChild(leftIcon);
  container.appendChild(clearIcon);

  syncClearVisibility();

  return {
    container,
    input,
    setValue: (value: string) => {
      input.value = value;
      syncClearVisibility();
    },
    clear: fireClear,
  };
}
