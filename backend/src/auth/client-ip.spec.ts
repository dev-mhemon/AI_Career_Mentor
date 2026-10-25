import express from 'express';
import { HttpException } from '@nestjs/common';
import type { Request } from 'express';
import request from 'supertest';
import { trustedClientIp, trustedProxyCidrs } from './client-ip.js';

describe('trusted client address', () => {
  it('rejects malformed proxy configuration and unavailable request addresses', () => {
    expect(() => trustedProxyCidrs('127.0.0.1/33')).toThrow(
      'AUTH_TRUSTED_PROXY_CIDRS',
    );
    expect(() => trustedProxyCidrs('not-an-address')).toThrow(
      'AUTH_TRUSTED_PROXY_CIDRS',
    );
    expect(() => trustedProxyCidrs('0.0.0.0/0')).toThrow(
      'AUTH_TRUSTED_PROXY_CIDRS',
    );
    expect(() => trustedClientIp({ ip: undefined } as Request)).toThrow();
    expect(() => trustedProxyCidrs('fe80::1%eth0')).toThrow(
      'AUTH_TRUSTED_PROXY_CIDRS',
    );
    expect(() => trustedProxyCidrs('0.0.0.0/1,128.0.0.0/1')).toThrow(
      'AUTH_TRUSTED_PROXY_CIDRS',
    );
    expect(() => trustedProxyCidrs('::/1,8000::/1')).toThrow(
      'AUTH_TRUSTED_PROXY_CIDRS',
    );
    expect(() => trustedProxyCidrs('::ffff:0:0/96')).toThrow(
      'AUTH_TRUSTED_PROXY_CIDRS',
    );
    expect(() => trustedProxyCidrs('::ffff:0:0/97,::ffff:8000:0/97')).toThrow(
      'AUTH_TRUSTED_PROXY_CIDRS',
    );
  });

  it('ignores client-controlled forwarding headers without a trusted proxy', async () => {
    const app = express();
    app.set('trust proxy', trustedProxyCidrs(undefined));
    app.get('/ip', (req, res) => res.json({ ip: trustedClientIp(req) }));
    const result = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.7');
    expect(result.status).toBe(200);
    expect(result.body.ip).not.toBe('198.51.100.7');
  });

  it('ignores spoofed forwarding headers from an untrusted socket peer', async () => {
    const app = express();
    app.set('trust proxy', trustedProxyCidrs('192.0.2.10/32'));
    app.get('/ip', (req, res) => res.json({ ip: trustedClientIp(req) }));
    const result = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.7');
    expect(result.status).toBe(200);
    expect(result.body.ip).not.toBe('198.51.100.7');
  });

  it('uses the first untrusted hop behind an explicitly trusted local ingress', async () => {
    const app = express();
    app.set('trust proxy', trustedProxyCidrs('127.0.0.1/32,::1/128'));
    app.get('/ip', (req, res) => res.json({ ip: trustedClientIp(req) }));
    const result = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '203.0.113.9, 198.51.100.7');
    expect(result.status).toBe(200);
    expect(result.body.ip).toBe('198.51.100.7');
  });

  it.each(['203.0.113.9', '2001:db8::9', '::ffff:203.0.113.9'])(
    'returns untrusted client %s through multiple trusted hops and a mapped socket',
    async (client) => {
      const app = express();
      app.set(
        'trust proxy',
        trustedProxyCidrs('::ffff:127.0.0.1/128,198.51.100.7/32'),
      );
      app.get('/ip', (req, res) => res.json({ ip: trustedClientIp(req) }));
      const result = await request(app)
        .get('/ip')
        .set('X-Forwarded-For', `${client}, 198.51.100.7`);
      expect(result.status).toBe(200);
      expect(result.body.ip).toBe(client);
    },
  );

  it('rejects a chain containing only trusted proxies at the original hop index', async () => {
    const app = express();
    app.set(
      'trust proxy',
      trustedProxyCidrs('127.0.0.1/32,::1/128,198.51.100.7/32'),
    );
    const configuredTrust = app.get('trust proxy fn') as (
      address: string,
      hop: number,
    ) => boolean;
    const calls: [string, number][] = [];
    app.set('trust proxy', (address: string, hop: number) => {
      calls.push([address, hop]);
      return configuredTrust(address, hop);
    });
    app.get('/ip', (req, res) => {
      try {
        res.json({ ip: trustedClientIp(req) });
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        res.status(error.getStatus()).json(error.getResponse());
      }
    });
    const result = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '198.51.100.7');
    expect(result.status).toBe(503);
    expect(result.body.code).toBe('SERVICE_UNAVAILABLE');
    expect(calls).toContainEqual(['198.51.100.7', 1]);
  });

  it('fails closed if a trusted ingress omits or malforms the client hop', async () => {
    const app = express();
    app.set('trust proxy', trustedProxyCidrs('127.0.0.1/32,::1/128'));
    app.get('/ip', (req, res) => {
      try {
        res.json({ ip: trustedClientIp(req) });
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        res.status(error.getStatus()).json(error.getResponse());
      }
    });
    const missing = await request(app).get('/ip');
    const zone = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', 'fe80::1%eth0');
    const samePeer = await request(app)
      .get('/ip')
      .set('X-Forwarded-For', '127.0.0.1');
    expect(missing.status).toBe(503);
    expect(zone.status).toBe(503);
    expect(samePeer.status).toBe(503);
    expect(missing.body.code).toBe('SERVICE_UNAVAILABLE');
  });
});
