import { rootBlock } from 'components/framework/rootBlock';
import { setupAdmin } from './initialState';

rootBlock();
globalThis.onload = setupAdmin;
