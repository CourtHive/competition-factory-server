import { governors, askEngine } from 'tods-competition-factory';

const methods = {
  ...governors.reportGovernor,
  ...governors.queryGovernor,
};

// DECISION: import globally (4th arg) rather than into instance state.
// WHY: importMethods(methods) with no `global` flag writes instance methods, and this runs at
// module scope where no request context exists — fail-closed getInstanceState() would throw at
// import. getMutationEngine already imports its governors with global=true for the same reason.
askEngine.importMethods(methods, undefined, undefined, true);

export const queryEngine = askEngine;
export default queryEngine;
