import { Agenda } from 'agenda';

// A single Agenda instance backed by the same MongoDB the rest of the app
// uses (job state lives in the `agendaJobs` collection). This only fires
// jobs while THIS Node process is actually running — if the backend is
// deployed on a host that spins down when idle (e.g. Render's free tier),
// a scheduled payroll run due at, say, 07:00 won't fire until something
// wakes the process back up, and will then run late rather than on time.
// For payroll specifically, that's worth knowing about: either run this on
// an always-on instance, or pair it with an external uptime pinger so the
// process never fully sleeps.
const agenda = new Agenda({
  db: { address: process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/antigravity_hrms', collection: 'agendaJobs' },
  processEvery: '5 minutes',
});

agenda.on('fail', (err, job) => {
  console.error(`Agenda job "${job.attrs.name}" failed:`, err.message);
});

export default agenda;
