import { StorageConfig } from './app/storage';
import { APPConfig } from './app/config';
import tracker from './app/tracker';
import redis from './cache/redis';
import email from './app/email';

export const configurations = [APPConfig, StorageConfig, email, tracker, redis];
