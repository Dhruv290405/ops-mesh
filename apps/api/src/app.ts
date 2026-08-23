import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { createServer, Server } from 'node:http';
import { Server as SocketIOServer } from 'socket.io';
import { getConfig, getCorsOrigins } from '@opsmesh/config';
import { requestContextMiddleware } from './middleware/request-context';
import { defaultApiRateLimit } from './middleware/rate-limit';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { logger } from './common/logger';
import { wsHub } from './common/ws-hub';
import { startRealtimeBridge } from './common/realtime-bridge';
import { recordLatency } from './common/latency';

import authRoutes from './modules/auth/auth.routes';
import servicesRoutes from './modules/services/services.routes';
import eventsRoutes from './modules/events/events.routes';
import incidentsRoutes from './modules/incidents/incidents.routes';
import teamsRoutes from './modules/teams/teams.routes';
import onCallRoutes from './modules/oncall/oncall.routes';
import escalationRoutes from './modules/escalation/escalation.routes';
import notificationsRoutes from './modules/notifications/notifications.routes';
import auditRoutes from './modules/audit/audit.routes';
import metricsRoutes from './modules/metrics/metrics.routes';
import healthRoutes from './modules/health/health.routes';
import apiKeysRoutes from './modules/apikeys/api-keys.routes';
import systemRoutes from './modules/system/system.routes';

export interface OpsMeshApp {
  app: Express;
  httpServer: Server;
  io: SocketIOServer;
}

export function createApp(): OpsMeshApp {
  const config = getConfig();
  const app = express();
  const httpServer = createServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: getCorsOrigins(config), methods: ['GET', 'POST'] }
  });

  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: getCorsOrigins(config), credentials: true }));
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));
  app.use(requestContextMiddleware);
  app.use(defaultApiRateLimit());

  wsHub.attach(io);

  app.use((_req, res, next) => {
    const start = Date.now();
    res.on('finish', () => recordLatency(Date.now() - start));
    next();
  });

  app.get('/', (_req, res) => {
    res.json({ name: 'OpsMesh API', version: '1.0.0' });
  });

  app.use('/health', healthRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/services', servicesRoutes);
  app.use('/api/v1/events', eventsRoutes);
  app.use('/api/v1/incidents', incidentsRoutes);
  app.use('/api/v1', teamsRoutes); // /teams, /users
  app.use('/api/v1/on-call', onCallRoutes);
  app.use('/api/v1/escalation-policies', escalationRoutes);
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/v1/api-keys', apiKeysRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  app.use('/api/v1/metrics', metricsRoutes);
  app.use('/api/v1/system', systemRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  logger.info({ port: config.PORT }, 'OpsMesh API created');

  startRealtimeBridge();

  return { app, httpServer, io };
}