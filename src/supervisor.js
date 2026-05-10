import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

dotenv.config({ override: true });

const root = process.cwd();
const port = Number(process.env.PORT || process.env.DASHBOARD_PORT || 3333);
const healthUrl = `http://127.0.0.1:${port}/healthz`;
const logsDir = path.join(root, "logs");
const supervisorLog = path.join(logsDir, "supervisor.log");
const botOutLog = path.join(logsDir, "bot.out.log");
const botErrLog = path.join(logsDir, "bot.err.log");

fs.mkdirSync(logsDir, { recursive: true });

let child = null;
let stopping = false;
let restartTimer = null;
let failedHealthChecks = 0;
let restartDelay = 1500;

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(supervisorLog, `${line}\n`, "utf8");
}

function startBot(reason = "start") {
  if (child && !child.killed) return;

  dotenv.config({ override: true });
  log(`Starting bot (${reason})`);
  const out = fs.openSync(botOutLog, "a");
  const err = fs.openSync(botErrLog, "a");

  child = spawn(process.execPath, ["src/index.js"], {
    cwd: root,
    env: { ...process.env, KYRAVO_SUPERVISED: "1" },
    stdio: ["ignore", out, err],
    windowsHide: true
  });

  failedHealthChecks = 0;

  child.on("exit", (code, signal) => {
    fs.closeSync(out);
    fs.closeSync(err);
    const summary = signal ? `signal ${signal}` : `code ${code}`;
    log(`Bot stopped with ${summary}`);
    child = null;

    if (!stopping) scheduleRestart("process stopped");
  });

  child.on("error", (error) => {
    log(`Could not start bot: ${error.message}`);
    child = null;
    if (!stopping) scheduleRestart("start error");
  });
}

function scheduleRestart(reason) {
  if (restartTimer) return;
  const delay = restartDelay;
  restartDelay = Math.min(restartDelay * 1.6, 30_000);
  log(`Restarting in ${Math.round(delay / 1000)}s (${reason})`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    startBot(reason);
  }, delay);
}

function restartBot(reason) {
  log(`Restart requested: ${reason}`);
  failedHealthChecks = 0;
  restartDelay = 1500;

  if (child && !child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child && !child.killed) child.kill("SIGKILL");
    }, 5000);
  } else {
    startBot(reason);
  }
}

async function checkHealth() {
  if (!child || stopping) return;

  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    failedHealthChecks = 0;
    restartDelay = 1500;
  } catch (error) {
    failedHealthChecks += 1;
    log(`Health check failed ${failedHealthChecks}/3: ${error.message}`);
    if (failedHealthChecks >= 3) restartBot("dashboard unreachable");
  }
}

function stopSupervisor(signal) {
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  log(`Supervisor stopping (${signal})`);

  if (child && !child.killed) {
    child.kill("SIGTERM");
    setTimeout(() => process.exit(0), 6000);
  } else {
    process.exit(0);
  }
}

process.on("SIGINT", () => stopSupervisor("SIGINT"));
process.on("SIGTERM", () => stopSupervisor("SIGTERM"));
process.on("uncaughtException", (error) => {
  log(`Supervisor error: ${error.stack || error.message}`);
});
process.on("unhandledRejection", (reason) => {
  log(`Supervisor rejection: ${reason?.stack || reason}`);
});

startBot();
setInterval(checkHealth, 15_000);
