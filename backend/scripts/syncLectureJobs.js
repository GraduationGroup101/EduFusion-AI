// Reconciles saved LectureScribe jobs with the transcription service: unfinished
// jobs get their current status, finished ones have their transcripts stored, and
// jobs the service lost are marked so. Run manually or from a scheduler
// (`npm run lectures:sync --prefix backend`); requests and callbacks do the same
// work as they happen, this is the backstop.
const { pool } = require('../src/db');
const store = require('../src/db/appStore');
const library = require('../src/lectureLibrary');

const sync = async ({ budgetMs = 10 * 60 * 1000, concurrency = 3 } = {}) => {
  const jobs = await store.listUnsettledJobs();
  // Completed jobs missing a stored transcript kind are swept too (syncJob stores them).
  const synced = await library.syncPending(jobs, { budgetMs, concurrency, include: (job) => job.status === 'completed' });
  const counts = {};
  for (const job of synced) counts[job.status || 'unknown'] = (counts[job.status || 'unknown'] || 0) + 1;
  return { checked: jobs.length, statuses: counts };
};

if (require.main === module) {
  // A scheduler with a short job limit can bound the run (milliseconds).
  sync({ budgetMs: Number(process.env.LECTURE_SYNC_BUDGET_MS) || undefined })
    .then((report) => console.log(`Checked ${report.checked} lecture jobs: ${JSON.stringify(report.statuses)}`))
    .catch((error) => { console.error(error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}
module.exports = { sync };
