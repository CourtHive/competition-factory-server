import { StorageConfig } from './app/storage';
import { APPConfig } from './app/config';
import redis from './cache/redis';

export const configurations = [APPConfig, StorageConfig, redis];
