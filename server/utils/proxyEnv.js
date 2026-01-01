export function buildProxyEnv(providerPrefix) {
  if (!providerPrefix) {
    return {};
  }

  const mappings = [
    { suffix: 'HTTP_PROXY', lower: 'http_proxy', upper: 'HTTP_PROXY' },
    { suffix: 'HTTPS_PROXY', lower: 'https_proxy', upper: 'HTTPS_PROXY' },
    { suffix: 'NO_PROXY', lower: 'no_proxy', upper: 'NO_PROXY' }
  ];

  const env = {};

  for (const mapping of mappings) {
    const key = `${providerPrefix}_${mapping.suffix}`;
    const value = process.env[key];

    if (value && value.trim() !== '') {
      env[mapping.lower] = value;
      env[mapping.upper] = value;
    }
  }

  return env;
}
