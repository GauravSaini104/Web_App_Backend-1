import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';

/**
 * Trims whitespace and hidden characters (e.g. tabs `\t`) from request body keys.
 * This prevents validation failures caused by accidental trailing tabs in form-data tools like Postman.
 */
@Injectable()
export class BodyKeyTrimmerInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      const trimmedBody: Record<string, any> = {};
      for (const [key, value] of Object.entries(req.body)) {
        trimmedBody[key.trim()] = value;
      }
      req.body = trimmedBody;
    }
    return next.handle();
  }
}
