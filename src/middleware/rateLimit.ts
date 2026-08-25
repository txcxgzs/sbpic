import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const uploadRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: config.rateLimitPerMin,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
});
