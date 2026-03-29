import { getToken, removeToken } from './tokenManagement';
import { jwtDecode } from 'jwt-decode';

import type { LoginState } from 'types/tmx';

export function validateToken(token?: string | null): LoginState | undefined {
  if (!token) return undefined;

  let decoded: LoginState;
  try {
    decoded = jwtDecode<LoginState>(token);
  } catch {
    removeToken();
    return undefined;
  }

  const now = Date.now() / 1000;
  if (decoded.exp < now) {
    removeToken();
    return undefined;
  }

  return decoded;
}

export function getValidatedState(): LoginState | undefined {
  return validateToken(getToken());
}
