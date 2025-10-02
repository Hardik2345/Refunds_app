const Redis = require("ioredis");
const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379");

const keys = await redis.keys("*"); // careful in prod
console.log(keys);


module.exports = redis;