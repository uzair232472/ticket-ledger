import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export let redisConnected = false;

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  retryStrategy(times) {
    if (times > 3) {
      return null;
    }
    return Math.min(times * 200, 1000);
  },
  lazyConnect: true,
});

redis.on('connect', () => {
  redisConnected = true;
  console.log('✅ Redis connected successfully');
});

redis.on('error', () => {
  redisConnected = false;
});

export const connectRedis = async () => {
  try {
    await redis.connect();
  } catch (err) {
    redisConnected = false;
    console.warn('⚠️  Redis server offline. Using atomic in-memory lock store with TTL.');
  }
};

// In-Memory fallback store for environments without running Redis container
const inMemoryLocks = new Map();

/**
 * Atomically acquires a seat lock for TTL seconds (default 10 minutes = 600s)
 * Returns true if lock was acquired, false if seat is already locked.
 */
export const acquireSeatLock = async (seatId, userId, ttlSeconds = 600) => {
  const lockKey = `seat:lock:${seatId}`;

  if (redisConnected) {
    try {
      const result = await redis.set(lockKey, userId, 'NX', 'EX', ttlSeconds);
      return result === 'OK';
    } catch (e) {
      console.warn('Redis lock error, using fallback:', e.message);
    }
  }

  // Resilient in-memory fallback
  const now = Date.now();
  const existing = inMemoryLocks.get(lockKey);

  if (existing && existing.expiresAt > now) {
    if (existing.userId === userId) {
      // Refresh lock if requested by the same user
      existing.expiresAt = now + ttlSeconds * 1000;
      return true;
    }
    return false; // Already locked by someone else
  }

  inMemoryLocks.set(lockKey, {
    userId,
    expiresAt: now + ttlSeconds * 1000,
  });

  return true;
};

/**
 * Releases a seat lock
 */
export const releaseSeatLock = async (seatId, userId) => {
  const lockKey = `seat:lock:${seatId}`;

  if (redisConnected) {
    try {
      const currentHolder = await redis.get(lockKey);
      if (!userId || currentHolder === userId) {
        await redis.del(lockKey);
        return true;
      }
      return false;
    } catch (e) {
      console.warn('Redis release error, using fallback:', e.message);
    }
  }

  const existing = inMemoryLocks.get(lockKey);
  if (!existing) return true;

  if (!userId || existing.userId === userId) {
    inMemoryLocks.delete(lockKey);
    return true;
  }

  return false;
};

/**
 * Checks if a seat is currently locked
 */
export const checkSeatLock = async (seatId) => {
  const lockKey = `seat:lock:${seatId}`;

  if (redisConnected) {
    try {
      const holder = await redis.get(lockKey);
      const ttl = await redis.ttl(lockKey);
      if (holder) {
        return { locked: true, userId: holder, ttl: Math.max(0, ttl) };
      }
      return { locked: false };
    } catch (e) {
      // fallback
    }
  }

  const existing = inMemoryLocks.get(lockKey);
  if (existing && existing.expiresAt > Date.now()) {
    const ttl = Math.round((existing.expiresAt - Date.now()) / 1000);
    return { locked: true, userId: existing.userId, ttl };
  }

  return { locked: false };
};
