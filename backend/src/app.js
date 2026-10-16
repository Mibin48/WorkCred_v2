import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoSanitize from 'express-mongo-sanitize';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createRateLimiter } from './middleware/rateLimiter.js';
import { pingDB } from './config/db.js';
import { formatSuccess, formatError, ErrorCodes } from './utils/errors.js';

export function createApp(config = {}) {
  const app = express();

  if (config.TRUST_PROXY) {
    app.set('trust proxy', 1);
  }

  // Security Headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https://res.cloudinary.com'],
        connectSrc: ["'self'", ...(config.FRONTEND_ORIGINS || [])]
      }
    },
    crossOriginEmbedderPolicy: false
  }));

  // Strict exact-origin CORS with credentials
  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, or server-to-server)
      if (!origin) return callback(null, true);
      const allowedOrigins = config.FRONTEND_ORIGINS || [];
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key']
  }));

  // JSON Body Parser with 10kb limit
  app.use(express.json({ limit: '10kb' }));

  // Cookie Parser
  app.use(cookieParser());

  // Mongo Operator Sanitization (strips $ and . from user input keys)
  app.use(mongoSanitize({
    allowDots: false
  }));

  // Global Rate Limiter
  const globalLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: 300,
    message: 'Too many requests from this IP'
  }, config.RATE_LIMIT_ENABLED !== false);
  app.use(globalLimiter);

  // Request Logger
  app.use(requestLogger);

  // Set standard API Cache-Control header
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
  });

  // Health check routes
  const apiRouter = express.Router();

  apiRouter.get('/health', (req, res) => {
    res.status(200).json(formatSuccess({ status: 'ok' }, 'Service is healthy'));
  });

  apiRouter.get('/health/ready', async (req, res) => {
    const isDbAlive = await pingDB();
    if (isDbAlive) {
      return res.status(200).json(formatSuccess({ database: 'connected' }, 'Service is ready'));
    }
    return res.status(503).json(formatError(ErrorCodes.SERVICE_UNAVAILABLE, 'Database connection is not ready'));
  });

  app.use('/api/v1', apiRouter);

  // 404 Route Handler
  app.use(notFoundHandler);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
