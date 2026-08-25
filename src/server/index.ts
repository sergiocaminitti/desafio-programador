import { createApp } from './app.js';

const PORT = process.env.PORT || 3000;

async function bootstrap() {
  const app = await createApp();
  app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`  Desafio Programador — Quick Filler`);
    console.log(`  Servidor rodando em http://localhost:${PORT}`);
    console.log(`  Healthz: http://localhost:${PORT}/healthz`);
    console.log(`=========================================`);
  });
}

bootstrap().catch(console.error);
