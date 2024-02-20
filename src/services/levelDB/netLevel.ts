import netLevelClient from '@gridspace/net-level-client';

// store any arguments set on startup
let args = {};

// keep track of bases in use
const bases = {};

// use constants for consistency
const methods = {
  get: 'get',
  set: 'set',
  del: 'del',
  keys: 'keys',
  list: 'list',
  cull: 'cull',
  close: 'close',
};

const SUCCESS = { success: true };

// generic request handler to avoid code duplication
const requestHandler = (method) => (base, request?) =>
  new Promise((resolve, reject) => {
    try {
      if (method !== 'close' && !bases[base]) useBase({ args, base });
      bases[base][method](request).then(resolve, reject);
    } catch (err) {
      reject(err);
    }
  });

async function exit() {
  for (const base in bases) {
    await requestHandler(methods.close)(base);
  }
}

// net level access object definition
const netLevel = {
  setArgs: (values) => (args = values),
  get: (base, request) => requestHandler(methods.get)(base, request),
  set: (base, request) => requestHandler(methods.set)(base, request),
  keys: (base, request) => requestHandler(methods.keys)(base, request),
  list: (base, request) => requestHandler(methods.list)(base, request),
  cull: (base, request) => requestHandler(methods.cull)(base, request),
  delete: (base, request) => requestHandler(methods.del)(base, request),
  close: (base) => requestHandler(methods.close)(base),
  bases: () => bases,
  exit,
};

// define method to ready each base for use
function useBase({ args, base }) {
  // don't allow creation of two clients to same base
  if (bases[base]) return;

  // create new Net-Level client
  const db = new netLevelClient();

  function ensureConnection(timeout) {
    const start = Date.now();
    return new Promise(waitForConnection);

    function waitForConnection(resolve, reject) {
      if (connected) resolve();
      else if (timeout && Date.now() - start >= timeout) {
        reject(new Error(`Could not connect to ${base} in ${timeout} ms`));
        // @ts-expect-error this does not have type
      } else setTimeout(waitForConnection.bind(this, resolve, reject), 30);
    }
  }

  // initiate connection
  let connected;
  let connecting;
  async function connect() {
    try {
      if (connecting) {
        await ensureConnection(1000);
      } else {
        connecting = true;
        await db.open(args.dbHost || process.env.DB_HOST, args.dbPort || process.env.DB_PORT);
        await db.auth(args.dbUser || process.env.DB_USER, args.dbPass || process.env.DB_PASS);
        connected = true;
        connecting = false;
        await db.use(base, { create: true });
      }
    } catch (err) {
      throw err;
    }
  }

  // define each access method
  async function keys(request) {
    const isNumeric = (value) => !isNaN(parseFloat(value));
    try {
      if (!connected) await connect();
      if (!isNumeric(request?.from) && !isNumeric(request?.startsWith)) throw new Error('missing parameter for keys');
      return await db.keys({ pre: request.startsWith, gte: request.from, lt: request.to });
    } catch (err) {
      throw err;
    }
  }

  async function list(request) {
    try {
      if (!connected) await connect();
      if (!request?.from && !request?.startsWith && !request?.all === true) {
        throw new Error('missing parameter for list');
      }
      return await db.list({ pre: request.startsWith, gte: request.from, lt: request.to });
    } catch (err) {
      throw err;
    }
  }

  async function cull(request) {
    try {
      if (!connected) await connect();
      if (!(request?.from || request?.to) && !request?.startsWith) throw new Error('missing parameter for cull');
      return await db.cull({ pre: request.startsWith, gte: request.from, lt: request.to });
    } catch (err) {
      throw err;
    }
  }

  async function get(request) {
    try {
      if (!connected) await connect();
      if (!request?.key) throw new Error('missing { key } parameter for get');
      return await db.get(request.key);
    } catch (err) {
      throw err;
    }
  }

  async function set(request) {
    try {
      if (!connected) await connect();
      if (!request.key) throw new Error('missing { key } parameter for set');
      await db.put(request.key, request.value);
      return SUCCESS;
    } catch (err) {
      throw err;
    }
  }

  async function del(request) {
    try {
      if (!connected) await connect();
      if (!request.key) throw new Error('missing { key } parameter for del');
      await db.del(request.key);
      return SUCCESS;
    } catch (err) {
      throw err;
    }
  }

  async function close() {
    try {
      // remove base from bases
      delete bases[base];
      await db.close();
      return SUCCESS;
    } catch (err) {
      throw err;
    }
  }

  // add base to bases
  bases[base] = {
    [methods.get]: get,
    [methods.set]: set,
    [methods.del]: del,
    [methods.keys]: keys,
    [methods.list]: list,
    [methods.cull]: cull,
    [methods.close]: close,
  };
}

export default netLevel;
