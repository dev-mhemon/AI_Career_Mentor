import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AUTH_ABUSE_CONFIGURATION,
  AuthAbuseControl,
} from './abuse-control.service.js';
import { abuseConfigurationNames, readAbuseConfiguration } from './config.js';

@Module({
  providers: [
    {
      provide: AUTH_ABUSE_CONFIGURATION,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        readAbuseConfiguration(
          Object.fromEntries(
            abuseConfigurationNames.map((name) => [
              name,
              config.get<unknown>(name),
            ]),
          ),
        ),
    },
    AuthAbuseControl,
  ],
  exports: [AuthAbuseControl],
})
export class AuthAbuseControlModule {}
