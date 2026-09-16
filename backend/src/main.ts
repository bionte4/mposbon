import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { createCorsOriginDelegate } from './common/cors/cors-allowlist';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(AppConfigService);

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Decoupled SPA ↔ API: only FRONTEND_URL + CORS_ORIGINS may call the API from a browser.
  app.enableCors({
    origin: createCorsOriginDelegate(config.corsOrigins),
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Tenant-Slug',
      'X-User-Id',
      'X-User-Email',
      'X-Request-Id',
    ],
  });

  await app.listen(config.appPort);
}

bootstrap();
