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
import { createAuthMiddleware } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { createUsersRouter } from './routes/users.js';
import { createMetaRouter } from './routes/meta.js';
import { createUploadsRouter } from './routes/uploads.js';
import { createWorkersRouter } from './routes/workers.js';
import { createCompassRouter } from './routes/compass.js';
import { createJobsRouter } from './routes/jobs.js';
import { createBookingsRouter } from './routes/bookings.js';
import { createPassportRouter } from './routes/passport.js';
import { createAvailabilityRouter } from './routes/availability.js';
import { createPostsRouter } from './routes/posts.js';
import { createFeedRouter } from './routes/feed.js';
import { createFollowsRouter } from './routes/follows.js';
import { createEndorsementsRouter } from './routes/endorsements.js';
import { createReportsRouter } from './routes/reports.js';
import { createDemoRouter } from './routes/demo.js';
import { idempotency } from './middleware/idempotency.js';

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

  // Mount Routers
  const authMiddleware = createAuthMiddleware(config);
  const idempotencyMiddleware = { idempotency };

  const authRouter = createAuthRouter(config, authMiddleware);
  const usersRouter = createUsersRouter(config, authMiddleware);
  const metaRouter = createMetaRouter(config, authMiddleware);
  const uploadsRouter = createUploadsRouter(config, authMiddleware);
  const workersRouter = createWorkersRouter(config, authMiddleware);
  const compassRouter = createCompassRouter(config, authMiddleware);
  const jobsRouter = createJobsRouter(config, authMiddleware, idempotencyMiddleware);

  const bookingsRouter = createBookingsRouter(config, authMiddleware);
  const passportRouter = createPassportRouter(config, authMiddleware);
  const availabilityRouter = createAvailabilityRouter(config, authMiddleware);
  const postsRouter = createPostsRouter(config, authMiddleware, idempotencyMiddleware);
  const feedRouter = createFeedRouter(config, authMiddleware);
  const followsRouter = createFollowsRouter(config, authMiddleware);
  const endorsementsRouter = createEndorsementsRouter(config, authMiddleware);
  const reportsRouter = createReportsRouter(config, authMiddleware);
  const demoRouter = createDemoRouter(config);

  apiRouter.use('/auth', authRouter);
  apiRouter.use('/users', usersRouter);
  apiRouter.use('/meta', metaRouter);
  apiRouter.use('/uploads', uploadsRouter);
  apiRouter.use('/workers', workersRouter);
  apiRouter.use('/compass', compassRouter);
  apiRouter.use('/jobs', jobsRouter);
  apiRouter.use('/bookings', bookingsRouter);
  apiRouter.use('/passport', passportRouter);
  apiRouter.use('/availability', availabilityRouter);
  apiRouter.use('/posts', postsRouter);
  apiRouter.use('/feed', feedRouter);
  apiRouter.use('/follows', followsRouter);
  apiRouter.use('/endorsements', endorsementsRouter);
  apiRouter.use('/reports', reportsRouter);
  apiRouter.use('/demo', demoRouter);

  app.use('/api/v1', apiRouter);

  // 404 Route Handler
  app.use(notFoundHandler);

  // Global Error Handler
  app.use(errorHandler);

  return app;
}
