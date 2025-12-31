const proxyKeyMap = {
  claude: 'CLAUDE',
  codex: 'CODEX'
};

let proxyEnvQueue = Promise.resolve();

function buildProxyEnv(prefix) {
  if (!prefix) {
    return {};
  }

  const httpProxy = process.env[`${prefix}_HTTP_PROXY`];
  const httpsProxy = process.env[`${prefix}_HTTPS_PROXY`];
  const noProxy = process.env[`${prefix}_NO_PROXY`];

  const env = {};

  if (httpProxy && httpProxy.trim()) {
    env.http_proxy = httpProxy.trim();
    env.HTTP_PROXY = httpProxy.trim();
  }

  if (httpsProxy && httpsProxy.trim()) {
    env.https_proxy = httpsProxy.trim();
    env.HTTPS_PROXY = httpsProxy.trim();
  }

  if (noProxy && noProxy.trim()) {
    env.no_proxy = noProxy.trim();
    env.NO_PROXY = noProxy.trim();
  }

  return env;
}

export function getProxyEnv(provider) {
  const prefix = proxyKeyMap[provider];
  return buildProxyEnv(prefix);
}

export async function withProxyEnv(provider, callback) {
  const envOverrides = getProxyEnv(provider);
  const envKeys = Object.keys(envOverrides);

  if (envKeys.length === 0) {
    return callback();
  }

  const runWithEnv = async () => {
    const previousValues = {};

    for (const key of envKeys) {
      previousValues[key] = process.env[key];
      process.env[key] = envOverrides[key];
    }

    try {
      return await callback();
    } finally {
      for (const key of envKeys) {
        if (typeof previousValues[key] === 'undefined') {
          delete process.env[key];
        } else {
          process.env[key] = previousValues[key];
        }
      }
    }
  };

  proxyEnvQueue = proxyEnvQueue.then(runWithEnv, runWithEnv);
  return proxyEnvQueue;
}
