import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { AuthAbuseControlModule } from './abuse-control.module.js';
import { AuthAbuseControl } from './abuse-control.service.js';

it('composes without Redis configuration or a network connection for existing routes', async () => {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
      }),
      AuthAbuseControlModule,
    ],
  }).compile();
  expect(module.get(AuthAbuseControl)).toBeInstanceOf(AuthAbuseControl);
  await module.close();
});
