import { governors, asyncEngine, globalState } from 'tods-competition-factory';
import asyncGlobalState from './asyncGlobalState';

globalState.setStateProvider(asyncGlobalState);
const engineAsync = asyncEngine(true);

engineAsync.importMethods(governors, true, 1);

export const mutationEngine = engineAsync;
export default engineAsync;
