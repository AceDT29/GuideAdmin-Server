import cron from 'node-cron';
import { GuidesModel } from '../modules/guides/guides.model.js';
import { SessionService } from './session.service.js';

/**
 * Inicializa las tareas programadas (cron jobs) de la aplicación.
 * @param {import('socket.io').Server} [io] Instancia de Socket.IO para notificar a los clientes conectados.
 * @param {string} [scheduleExpression] Expresión cron configurable (por defecto cada 16 horas: '0 *\/16 * * *').
 * @returns {import('node-cron').ScheduledTask} Tarea programada creada.
 */
export function initCronJobs(io = null, scheduleExpression = process.env.CRON_GUIDES_PURGE || '0 */16 * * *') {
  const task = cron.schedule(scheduleExpression, async () => {
    console.log(`[Cron] Iniciando mantenimiento periódico (${new Date().toISOString()})...`);
    try {
      // 1. Purga automática de guías
      const result = await GuidesModel.purgeAll();
      console.log(`[Cron] Purga de guías completada. Registros eliminados: ${result.deletedCount}`);

      // 2. Limpieza de sesiones de usuario expiradas
      const sessionResult = await SessionService.cleanupExpiredSessions();
      console.log(`[Cron] Limpieza de sesiones completada. Sesiones expiradas eliminadas: ${sessionResult.deletedCount}`);

      // Notificar a todos los clientes conectados a través de Socket.IO
      if (io) {
        io.emit('guidesCleared', {
          purgedAt: new Date().toISOString(),
          deletedCount: result.deletedCount
        });
        console.log('[Cron] Evento "guidesCleared" emitido a los clientes conectados.');
      }
    } catch (error) {
      console.error('[Cron] Error durante el mantenimiento programado:', error);
    }
  });

  console.log(`[Cron] Cronjob de purga de guías configurado con expresión: "${scheduleExpression}"`);
  return task;
}
