import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureHttp } from './common/http.js';
import { ConfigService } from '@nestjs/config';
import { trustedProxyCidrs } from './auth/client-ip.js';
const app = await NestFactory.create(AppModule);
configureHttp(
  app,
  trustedProxyCidrs(
    app.get(ConfigService).get<string>('AUTH_TRUSTED_PROXY_CIDRS'),
  ),
);
app.enableShutdownHooks();
await app.listen(process.env.PORT ?? 3200);
