import cron from 'node-cron';
import { runUpdateSoldCount } from './update-sold-count.job.js';

export async function initCronJobs() {
  // Mỗi đêm 02:00: cập nhật soldCount (allTime, last7d, last30d, last365d)
  cron.schedule('0 2 * * *', async () => {
    try {
      await runUpdateSoldCount();
    } catch (err) {
      console.error('[cron] update-sold-count failed:', err);
    }
  });
}
