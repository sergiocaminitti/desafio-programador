import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { router } from './routes.js';

export async function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Middleware de Log Seguro (Zero PII - apenas método, rota, status e tempo)
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      console.log(`[HTTP] ${req.method} ${req.path} ${res.statusCode} - ${duration}ms`);
    });
    next();
  });

  // Rotas da API
  app.use(router);

  // Modo de Desenvolvimento: Vite Dev Server integrado com Hot-Reloading instantâneo (HMR)
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Modo de Produção: Servir assets compilados estáticos (dist/client)
    const clientDistPath = path.join(process.cwd(), 'dist', 'client');
    if (fs.existsSync(clientDistPath)) {
      app.use(express.static(clientDistPath));
      app.get('*', (req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/healthz')) {
          return next();
        }
        res.sendFile(path.join(clientDistPath, 'index.html'));
      });
    }
  }

  return app;
}
