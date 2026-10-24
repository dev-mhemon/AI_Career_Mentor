import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureHttp } from './common/http.js';
const app = await NestFactory.create(AppModule);
configureHttp(app);
app.enableShutdownHooks();
await app.listen(process.env.PORT ?? 3200);
