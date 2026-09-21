import cron from 'node-cron';
import { GuidesModel } from '../modules/guides/guides.model.js';

/**
 * Inicializa las tareas programadas (cron jobs) de la aplicación.
 * @param {import('socket.io').Server} [io] Instancia de Socket.IO para notificar a los clientes conectados.
 * @param {string} [scheduleExpression] Expresión cron configurable (por defecto cada 16 horas: '0 *\/16 * * *').
 * @returns {import('node-cron').ScheduledTask} Tarea programada creada.
 */
export function initCronJobs(io = null, scheduleExpression = process.env.CRON_GUIDES_PURGE || '0 */16 * * *') {
  const task = cron.schedule(scheduleExpression, async () => {
    console.log(`[Cron] Iniciando purga automática de guías (${new Date().toISOString()})...`);
    try {
      const result = await GuidesModel.purgeAll();
      console.log(`[Cron] Purga completada exitosamente. Registros eliminados: ${result.deletedCount}`);

      // Notificar a todos los clientes conectados a través de Socket.IO
      if (io) {
        io.emit('guidesCleared', {
          purgedAt: new Date().toISOString(),
          deletedCount: result.deletedCount
        });
        console.log('[Cron] Evento "guidesCleared" emitido a los clientes conectados.');
      }
    } catch (error) {
      console.error('[Cron] Error durante la purga de guías:', error);
    }
  });

  console.log(`[Cron] Cronjob de purga de guías configurado con expresión: "${scheduleExpression}"`);
  return task;
}
