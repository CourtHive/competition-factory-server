import { APPConfig } from './app/config';
import tracker from './app/tracker';
import redis from './cache/redis';
import email from './app/email';

export const configurations = [APPConfig, email, tracker, redis];
