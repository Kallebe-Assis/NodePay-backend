import closeWithGrace from 'close-with-grace';
import { buildApp } from './app.js';
import { env } from './config/env.js';
import { startJobs, stopJobs } from './modules/jobs/index.js';

async function main() {
  const app = await buildApp();

  if (env.JOBS_ENABLED) {
    await startJobs(app).catch((err) => app.log.error({ err }, 'Falha ao iniciar jobs'));
  }

  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.log.info(`🚀 NodePay API em http://${env.API_HOST}:${env.API_PORT} (docs: /docs)`);

  closeWithGrace({ delay: 5000 }, async ({ err }) => {
    if (err) app.log.error({ err }, 'Encerrando por erro');
    await stopJobs();
    await app.close();
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
