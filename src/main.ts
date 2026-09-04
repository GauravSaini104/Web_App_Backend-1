import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';

async function bootstrap() {
  // rawBody: true preserves the exact request bytes alongside the parsed
  // JSON — the payment webhook needs the untouched raw body to verify
  // Razorpay's signature, since re-serializing the parsed JSON would not
  // byte-for-byte match what Razorpay actually signed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Uploaded product photos are saved to disk and served back from here —
  // e.g. a file saved to uploads/products/abc.jpg is reachable at
  // /uploads/products/abc.jpg.
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads/' });

  // Strips unknown properties and rejects invalid request bodies before
  // they ever reach a controller — the app's main line of defense against
  // bad input.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Converts uncaught/HTTP errors into one consistent JSON shape.
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor());

  const corsOrigins = (configService.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  const isProduction = configService.get<string>('NODE_ENV') === 'production';

  app.enableCors({
    origin:
      corsOrigins.includes('*') || corsOrigins.length === 0
        ? true
        : corsOrigins,
    credentials: true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    allowedHeaders: 'Content-Type,Accept,Authorization,x-staff-bootstrap-secret',
  });

  const port = configService.get<number>('PORT') ?? 3000;
  // Binding the host explicitly avoids relying on Node's default interface
  // selection, which can behave inconsistently (e.g. IPv6-only) across
  // container networking setups and leave a reverse proxy unable to connect.
  await app.listen(port, '0.0.0.0');
  logger.log(`Grocery backend listening on http://0.0.0.0:${port}`);
}

bootstrap();
