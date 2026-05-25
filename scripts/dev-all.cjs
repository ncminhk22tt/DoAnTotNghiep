const { spawn } = require("child_process");

const nextBin = "./node_modules/next/dist/bin/next";
const nodeArgsBase = ["--max-old-space-size=4096", nextBin, "dev"];

let shuttingDown = false;
const states = {
  backend: "starting",
  frontend: "starting",
};

function run(name, port, appTarget) {
  const child = spawn(process.execPath, [...nodeArgsBase, "-p", String(port)], {
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      APP_TARGET: appTarget,
    },
  });

  states[name] = "running";

  child.on("exit", (code, signal) => {
    states[name] = "stopped";
    console.log(`[${name}] exited with code=${code} signal=${signal ?? "none"}`);

    if (shuttingDown) return;

    const other = name === "backend" ? "frontend" : "backend";
    if (states[other] === "stopped") {
      shutdown(code ?? 0);
      return;
    }

    console.log(`[dev] ${other} is still running. Fix ${name} and restart if needed.`);
  });

  return child;
}

const backend = run("backend", 3000, "backend");
const frontend = run("frontend", 5173, "frontend");

function shutdown(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;

  for (const proc of [backend, frontend]) {
    if (!proc.killed) proc.kill("SIGTERM");
  }

  setTimeout(() => {
    for (const proc of [backend, frontend]) {
      if (!proc.killed) proc.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 1000);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
