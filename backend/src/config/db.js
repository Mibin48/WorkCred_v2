import mongoose from 'mongoose';
import { logger } from '../utils/logger.js';

let isConnected = false;

export async function connectDB(mongoUri) {
  if (isConnected) return mongoose.connection;

  mongoose.connection.on('connected', () => {
    isConnected = true;
    logger.info('MongoDB connection established successfully');
  });

  mongoose.connection.on('error', (err) => {
    logger.error({ err: err.message }, 'MongoDB connection error');
  });

  mongoose.connection.on('disconnected', () => {
    isConnected = false;
    logger.warn('MongoDB disconnected');
  });

  await mongoose.connect(mongoUri, {
    autoIndex: true
  });

  isConnected = true;
  return mongoose.connection;
}

export async function disconnectDB() {
  if (!isConnected && mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  isConnected = false;
}

export async function pingDB() {
  if (!mongoose.connection || mongoose.connection.readyState !== 1) {
    return false;
  }
  try {
    const adminDb = mongoose.connection.db.admin();
    const result = await adminDb.ping();
    return result && result.ok === 1;
  } catch {
    return false;
  }
}
