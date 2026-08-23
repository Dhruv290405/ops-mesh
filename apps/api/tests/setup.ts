import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
process.env.NODE_ENV = 'test';
process.env.REDIS_URL = 'memory';
process.env.RABBITMQ_URL = 'memory';