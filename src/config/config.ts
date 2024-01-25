import { APPConfig } from './app/config';
import tracker from './app/tracker';
import redis from './cache/redis';

export const configurations = [APPConfig, tracker, redis];
