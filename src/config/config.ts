import { APPConfig } from './app/config';
import tracker from './app/tracker';
import redis from './cache/redis';
import mail from './app/mail';

export const configurations = [APPConfig, tracker, redis, mail];
