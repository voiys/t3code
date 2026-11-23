#!/usr/bin/env node
// Fork-only: checks these specs with tla-ts on several cores (its CLI stays on one).
//   node apps/web/src/fork/tla/check.mjs [--workers N] [--minutes M] [Config ...]
// Each config runs against the module its name starts with; a run cut off by the time limit is
// bounded, not exhaustive.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const TLA_TS_VERSION = "0.0.10";
const HERE = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const CACHE = NodePath.join(NodeOS.homedir(), ".cache", "t3code-fork-tla", TLA_TS_VERSION);

function tlaTsEntry() {
  const entry = NodePath.join(CACHE, "node_modules", "tla-ts", "dist", "index.js");
  if (!NodeFS.existsSync(entry)) {
    console.error(`installing tla-ts@${TLA_TS_VERSION} into ${CACHE}`);
    NodeChildProcess.execFileSync(
      "npm",
      [
        "install",
        "--prefix",
        CACHE,
        "--no-save",
        "--no-audit",
        "--no-fund",
        `tla-ts@${TLA_TS_VERSION}`,
      ],
      { stdio: "inherit" },
    );
  }
  return NodeURL.pathToFileURL(entry).href;
}

if (process.argv[2] === "--child") {
  const [, , , module, config, workers] = process.argv;
  const { check, formatValue } = await import(tlaTsEntry());
  const started = performance.now();
  const result = await check({
    source: NodeFS.readFileSync(module, "utf8"),
    config: NodeFS.readFileSync(config, "utf8"),
    loadModule: (name) => {
      const path = NodePath.join(HERE, `${name}.tla`);
      return NodeFS.existsSync(path) ? NodeFS.readFileSync(path, "utf8") : undefined;
    },
    workers: Number(workers),
    onProgress: (progress) => {
      if (progress.kind === "sequential-fallback") {
        console.log(
          `  warning: fell back to one worker over the string ${JSON.stringify(progress.string)}`,
        );
      }
    },
  });
  process.send?.({
    status: result.status,
    distinct: String(result.distinctStates),
    generated: String(result.generatedStates),
    seconds: (performance.now() - started) / 1000,
    violation: result.violation
      ? {
          invariant: result.violation.invariant ?? result.violation.name ?? null,
          trace: result.violation.trace?.length ?? null,
          steps: (result.violation.trace ?? []).map((step, index) =>
            [
              `  state ${index + 1}:`,
              ...Object.entries(step.state ?? {}).map(
                ([name, value]) => `    ${name} = ${formatValue(value)}`,
              ),
            ].join("\n"),
          ),
        }
      : null,
    failure: result.failure ? String(result.failure.message ?? result.failure) : null,
  });
  process.exit(0);
}

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const [, value] = args.splice(index, 2);
  return Number(value);
};
const workers = option("--workers", Math.max(1, Math.floor(NodeOS.availableParallelism() / 2)));
const minutes = option("--minutes", 3);
const configs = (
  args.length > 0 ? args : NodeFS.readdirSync(HERE).filter((file) => file.endsWith(".cfg"))
)
  .map((name) => (name.endsWith(".cfg") ? name : `${name}.cfg`))
  .sort();
const modules = NodeFS.readdirSync(HERE)
  .filter((file) => file.endsWith(".tla"))
  .map((file) => NodePath.basename(file, ".tla"))
  .sort((a, b) => b.length - a.length);

tlaTsEntry();
let failed = false;
for (const config of configs) {
  const module = modules.find((name) => config.startsWith(name));
  if (!module || !NodeFS.existsSync(NodePath.join(HERE, config))) {
    console.log(`${config}: no such config, or no module it starts with`);
    failed = true;
    continue;
  }
  const child = NodeChildProcess.fork(NodeURL.fileURLToPath(import.meta.url), [
    "--child",
    NodePath.join(HERE, `${module}.tla`),
    NodePath.join(HERE, config),
    String(workers),
  ]);
  const outcome = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve({ status: "bounded" });
    }, minutes * 60_000);
    child.on("message", (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ status: "crashed", failure: `exit code ${code}` });
    });
  });
  const name = config.replace(/\.cfg$/, "");
  if (outcome.status === "success") {
    console.log(
      `${name}: ok, whole state space (${outcome.distinct} distinct, ${outcome.seconds.toFixed(1)}s)`,
    );
  } else if (outcome.status === "bounded") {
    console.log(`${name}: no violation within ${minutes} min (bounded, not exhaustive)`);
  } else {
    failed = true;
    const detail = outcome.violation
      ? `${outcome.violation.invariant} violated, trace of ${outcome.violation.trace} states`
      : (outcome.failure ?? "");
    console.log(`${name}: ${outcome.status} ${detail}`);
    for (const step of outcome.violation?.steps ?? []) console.log(step);
  }
}
process.exit(failed ? 1 : 0);
