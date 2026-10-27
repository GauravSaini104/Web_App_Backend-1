import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Converts every thrown error (Nest HTTP exceptions, Prisma errors,
 * anything else) into one consistent JSON error shape so API consumers
 * (mobile app, web app, admin panel) never have to guess the response
 * format.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    // Handle Multer errors explicitly (e.g. LIMIT_FILE_SIZE, LIMIT_FIELD_VALUE)
    if (exception && typeof exception === 'object' && 'name' in exception && (exception as any).name === 'MulterError') {
      const multerErr = exception as any;
      status = HttpStatus.PAYLOAD_TOO_LARGE;
      error = 'Payload Too Large';
      if (multerErr.code === 'LIMIT_FILE_SIZE') {
        message = 'Uploaded image file is too large. Maximum allowed size is 25MB.';
      } else if (multerErr.code === 'LIMIT_FIELD_VALUE') {
        message = 'Request payload field is too large. Please shorten the input data.';
      } else {
        message = multerErr.message || 'File upload error';
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const bodyObj = body as Record<string, unknown>;
        message = (bodyObj.message as string | string[]) ?? exception.message;
        error = (bodyObj.error as string) ?? exception.name;
      }
      if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
        message = 'Request or uploaded file size is too large (maximum allowed size is 25MB).';
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method} ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(`${request.method} ${request.url} -> ${status}: ${message}`);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      error,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
