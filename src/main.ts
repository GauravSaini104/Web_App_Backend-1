import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'node:path';
import { Request, Response, NextFunction, json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { BodyKeyTrimmerInterceptor } from './common/interceptors/body-key-trimmer.interceptor';

async function bootstrap() {
  // rawBody: true preserves the exact request bytes alongside the parsed
  // JSON — the payment webhook needs the untouched raw body to verify
  // Razorpay's signature, since re-serializing the parsed JSON would not
  // byte-for-byte match what Razorpay actually signed.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');
  const httpLogger = new Logger('HTTP');

  // Support larger payloads (up to 50MB) for base64 images, product data and rich uploads without 413 Payload Too Large
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ extended: true, limit: '50mb' }));

  // Log all incoming HTTP requests in real-time for live observability (e.g. PM2 logs)
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      httpLogger.log(`${req.method} ${req.originalUrl} ${res.statusCode} - ${Date.now() - start}ms`);
    });
    next();
  });

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
  app.useGlobalInterceptors(new BodyKeyTrimmerInterceptor(), new TransformInterceptor());

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
