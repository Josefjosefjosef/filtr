import fs from "node:fs";

const queuePath = "C:/projects/iu-cj-audits/FACTORY_QUEUE.json";
const queue = JSON.parse(fs.readFileSync(queuePath, "utf8"));
const tasks = Array.isArray(queue.tasks) ? queue.tasks : [];
const count = (state) => tasks.filter((task) => task.state === state).length;
const ready = tasks.filter((task) => task.state === "READY");
const summary = {
  unfinished: tasks.filter((task) => task.state !== "DONE").length,
  ready: ready.length,
  ciWait: count("CI_WAIT"),
  externalWait: count("EXTERNAL_WAIT"),
  ownerWait: count("OWNER_WAIT"),
  failedTests: count("FAILED"),
  integrationPending: count("INTEGRATION_PENDING"),
  productionPending: count("PRODUCTION_PENDING"),
  STOP_ALLOWED: ready.length === 0,
  next: ready[0] ? ready[0].id + " " + ready[0].title : null,
};
if (process.argv.includes("--hook")) {
  if (ready.length > 0) {
    process.stdout.write(
      JSON.stringify({
        followup_message:
          "STOP_ALLOWED=false. Unfinished " +
          summary.unfinished +
          ", ready " +
          summary.ready +
          ". Continue with " +
          summary.next +
          ". Do not end the session.",
      }),
    );
  } else {
    process.stdout.write("{}");
  }
} else {
  process.stdout.write(JSON.stringify(summary));
}
