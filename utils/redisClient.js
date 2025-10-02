const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

async function testRedisConnection() {
  const keys = await redis.keys("*"); // careful in prod
  console.log(keys);
}

testRedisConnection()

module.exports = redis;