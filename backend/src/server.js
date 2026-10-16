import http from 'node:http';
import { validateEnv } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

let server = null;

async function bootstrap() {
  try {
    const config = validateEnv(process.env);
    logger.info('Environment validated successfully');

    await connectDB(config.MONGODB_URI);

    const app = createApp(config);
    server = http.createServer(app);

    server.listen(config.PORT, () => {
      logger.info(`WorkCred Backend API listening on port ${config.PORT} (NODE_ENV: ${config.NODE_ENV})`);
    });

    const shutdown = async (signal) => {
      logger.info(`Received ${signal}, initiating graceful shutdown...`);

      if (server) {
        server.close(async () => {
          logger.info('HTTP server closed');
          await disconnectDB();
          logger.info('MongoDB connection closed. Exiting process.');
          process.exit(0);
        });
      } else {
        await disconnectDB();
        process.exit(0);
      }

      // Force shutdown after timeout
      setTimeout(() => {
        logger.error('Graceful shutdown timed out, forcing exit.');
        process.exit(1);
      }, 10000).unref();
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.fatal({ err: err.message }, 'Failed to start backend server');
    process.exit(1);
  }
}

// Start if executed directly
if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  bootstrap();
}

export { bootstrap };
