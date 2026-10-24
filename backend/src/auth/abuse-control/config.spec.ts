import { readAbuseConfiguration, operatingDefaults } from './config.js';

const synthetic = {
  AUTH_REDIS_URL: 'redis://127.0.0.1:56379',
  AUTH_HMAC_SECRET: 'synthetic-test-secret-at-least-32-bytes',
};
describe('R31 server-only validated operating configuration', () => {
  it('uses adopted defaults and permits positive integer overrides', () => {
    expect(readAbuseConfiguration(synthetic)?.policy).toEqual(
      operatingDefaults,
    );
    expect(
      readAbuseConfiguration({
        ...synthetic,
        AUTH_OTP_MAX_FAILURES: '8',
        AUTH_LOGIN_LOCKOUT_SECONDS: '12',
      })?.policy,
    ).toMatchObject({
      AUTH_OTP_MAX_FAILURES: 8,
      AUTH_LOGIN_LOCKOUT_SECONDS: 12,
    });
    expect(readAbuseConfiguration({})).toBeUndefined();
  });
  it.each(Object.keys(operatingDefaults))(
    'rejects invalid %s without echoing its value',
    (name) => {
      for (const value of [
        '0',
        '-1',
        '1.5',
        'Infinity',
        '1e2',
        '2147483648',
        'private-secret',
      ]) {
        expect(() =>
          readAbuseConfiguration({ ...synthetic, [name]: value }),
        ).toThrow(`Invalid ${name}`);
      }
    },
  );
  it.each([
    { AUTH_REDIS_URL: 'http://private-credential.invalid' },
    { AUTH_REDIS_URL: 'private-credential' },
    { AUTH_HMAC_SECRET: 'short' },
    { AUTH_HMAC_SECRET: undefined },
    { AUTH_HMAC_SECRET: 'replace_with_a_real_secret_of_at_least_32_bytes' },
  ])(
    'rejects malformed/partial/placeholder configuration safely',
    (override) => {
      expect(() =>
        readAbuseConfiguration({ ...synthetic, ...override }),
      ).toThrow(/AUTH_REDIS_URL|AUTH_HMAC_SECRET/);
    },
  );
});
