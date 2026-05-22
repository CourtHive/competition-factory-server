import { Environment, ConfigKey } from '../../common/constants/app';
import { registerAs } from '@nestjs/config';

export const APPConfig = registerAs(ConfigKey.App, () => ({
  env: Environment[process.env.NODE_ENV as keyof typeof Environment] || Environment.Development,
  port: Number(process.env.APP_PORT) || 8383,
  storage: String(process.env.APP_STORAGE),
  mode: String(process.env.APP_MODE),
  name: String(process.env.APP_NAME),
  // Public-facing base URL used by IdentityService to build email
  // verification + (future) password-reset links. Example values:
  //   prod:   https://nest.courthive.com
  //   dev:    http://localhost:8383   (or whatever NGINX exposes)
  baseUrl: process.env.APP_BASE_URL || '',
}));
