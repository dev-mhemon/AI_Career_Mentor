import { validateConfiguration } from './config.js';
const base = {
  SUPABASE_URL: 'http://127.0.0.1:56321',
  SUPABASE_ANON_KEY: 'sb_publishable_synthetic',
  DB_HOST: '127.0.0.1',
  DB_PORT: '56322',
  DB_USER: 'postgres',
  DB_PASSWORD: 'synthetic',
  DB_NAME: 'postgres',
};
describe('Public runtime key boundary', () => {
  it('accepts publishable keys', () => {
    expect(validateConfiguration(base)).toBe(base);
  });
  it('accepts a legacy anon JWT format', () => {
    const key =
      'header.' +
      Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url') +
      '.signature';
    expect(() =>
      validateConfiguration({ ...base, SUPABASE_ANON_KEY: key }),
    ).not.toThrow();
  });
  it.each([
    'sb_secret_synthetic',
    'header.' +
      Buffer.from(JSON.stringify({ role: 'service_role' })).toString(
        'base64url',
      ) +
      '.signature',
    'invalid',
  ])('rejects backend-only or malformed key format', (key) => {
    expect(() =>
      validateConfiguration({ ...base, SUPABASE_ANON_KEY: key }),
    ).toThrow('public anon');
  });
  it('fails early on missing database configuration', () => {
    expect(() =>
      validateConfiguration({ ...base, DB_PASSWORD: undefined }),
    ).toThrow('DB_PASSWORD');
  });
});
