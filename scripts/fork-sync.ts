#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off -- Standalone fork maintenance CLI.
// Usage: node scripts/fork-sync.ts <status|check|rebase|build-desktop> [--json]
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

const ROOT = NodePath.resolve(import.meta.dirname, "..");

const SIDECAR_PREFIXES = [
  "apps/web/src/plugins/",
  "apps/web/src/fork/",
  "apps/web/src/routes/_chat.settings.plugins.tsx",
  "scripts/fork-sync.ts",
  "FORK.md",
];

function isSidecarFile(file: string): boolean {
  return SIDECAR_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix));
}

function runCapture(
  cmd: string,
  args: readonly string[],
  options: { cwd?: string } = {},
): { status: number; stdout: string; stderr: string } {
  const res = NodeChildProcess.spawnSync(cmd, [...args], {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return {
    status: res.status ?? 1,
    stdout: res.stdout ?? "",
    stderr: res.stderr ?? "",
  };
}

function runInherit(cmd: string, args: readonly string[]): number {
  const res = NodeChildProcess.spawnSync(cmd, [...args], {
    cwd: ROOT,
    stdio: "inherit",
  });
  return res.status ?? 1;
}

function git(...args: string[]): string {
  const res = runCapture("git", args);
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed:\n${res.stderr || res.stdout}`);
  }
  return res.stdout.trim();
}

function parseFlags(argv: readonly string[]) {
  const flags = new Map<string, string | boolean>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith("--")) {
          flags.set(arg.slice(2), next);
          i += 1;
        } else {
          flags.set(arg.slice(2), true);
        }
      }
    } else {
      positional.push(arg);
    }
  }
  return { flags, positional };
}

function getFlagString(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: string,
): string {
  const val = flags.get(key);
  return typeof val === "string" ? val : fallback;
}

function cmdStatus(flags: Map<string, string | boolean>) {
  const ref = getFlagString(flags, "ref", "upstream/main");
  const json = flags.get("json") === true;
  const shouldFetch = flags.get("no-fetch") !== true;

  if (shouldFetch) {
    const remote = ref.split("/")[0];
    if (remote) {
      runCapture("git", ["fetch", remote, "--tags", "--quiet"]);
    }
  }

  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  const head = git("rev-parse", "--short", "HEAD");
  const target = git("rev-parse", "--short", ref);
  const [behindStr, aheadStr] = git("rev-list", "--left-right", "--count", `${ref}...HEAD`).split(
    /\s+/,
  );
  const behind = Number(behindStr ?? 0);
  const ahead = Number(aheadStr ?? 0);

  const dirty = git("status", "--porcelain").split("\n").filter(Boolean);
  const changedFiles = git("diff", "--name-only", `${ref}...HEAD`).split("\n").filter(Boolean);
  const upstreamTouched = changedFiles.filter((file) => !isSidecarFile(file));
  const sidecarFiles = changedFiles.filter((file) => isSidecarFile(file));

  const latestUpstreamTag = runCapture("git", [
    "describe",
    "--tags",
    "--abbrev=0",
    ref,
  ]).stdout.trim();

  const summary = {
    branch,
    head,
    targetRef: ref,
    targetSha: target,
    latestUpstreamTag: latestUpstreamTag || null,
    behind,
    ahead,
    dirtyCount: dirty.length,
    needsSync: behind > 0,
    upstreamTouchedCount: upstreamTouched.length,
    upstreamTouched,
    sidecarFileCount: sidecarFiles.length,
  };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
    return 0;
  }

  console.log(`Branch: ${branch} (${head}) vs ${ref} (${target})`);
  if (latestUpstreamTag) console.log(`Latest upstream tag: ${latestUpstreamTag}`);
  console.log(`Behind: ${behind} | Ahead: ${ahead} | Dirty files: ${dirty.length}`);
  console.log(
    `Touched upstream glue files (${upstreamTouched.length}):\n${upstreamTouched.map((f) => `  - ${f}`).join("\n") || "  (none)"}`,
  );
  console.log(`Isolated sidecar files: ${sidecarFiles.length}`);
  return 0;
}

function cmdCheck(flags: Map<string, string | boolean>) {
  const full = flags.get("full") === true;
  const json = flags.get("json") === true;

  const steps: Array<{ readonly name: string; readonly cmd: string; readonly args: string[] }> = [
    {
      name: "typecheck",
      cmd: "vp",
      args: full
        ? ["run", "-r", "--cache", "--concurrency-limit", "4", "typecheck"]
        : ["run", "--filter", "@t3tools/web", "typecheck"],
    },
    {
      name: "plugin-and-fork-tests",
      cmd: "vp",
      args: [
        "test",
        "run",
        "apps/web/src/plugins/host.test.ts",
        "apps/web/src/plugins/packs/nodecode-icon/nodecode-icon.test.ts",
        "apps/web/src/fork/sidebar/sections.logic.test.ts",
        "apps/web/src/fork/split/threadSplitStore.test.ts",
      ],
    },
  ];

  const results: Array<{ name: string; ok: boolean; status: number; output?: string }> = [];
  let allOk = true;

  for (const step of steps) {
    if (!json) {
      console.log(`\n==> Running ${step.name}...`);
      const status = runInherit(step.cmd, step.args);
      const ok = status === 0;
      results.push({ name: step.name, ok, status });
      if (!ok) {
        allOk = false;
        break;
      }
    } else {
      const res = runCapture(step.cmd, step.args);
      const ok = res.status === 0;
      results.push({
        name: step.name,
        ok,
        status: res.status,
        ...(ok ? {} : { output: `${res.stdout}\n${res.stderr}`.slice(-4000) }),
      });
      if (!ok) {
        allOk = false;
        break;
      }
    }
  }

  if (json) {
    console.log(JSON.stringify({ ok: allOk, steps: results }, null, 2));
  } else {
    console.log(allOk ? "\n✓ All fork checks passed." : "\n✗ Fork checks failed.");
  }
  return allOk ? 0 : 1;
}

function cmdRebase(flags: Map<string, string | boolean>) {
  const ref = getFlagString(flags, "ref", "upstream/main");
  const inPlace = flags.get("in-place") === true;
  const abortOnConflict = flags.get("abort-on-conflict") === true;
  const json = flags.get("json") === true;

  const dirty = git("status", "--porcelain");
  if (dirty) {
    const msg = "Working tree is not clean. Commit or stash changes before rebasing.";
    if (json) console.log(JSON.stringify({ ok: false, error: msg }));
    else console.error(msg);
    return 1;
  }

  const remote = ref.split("/")[0];
  if (remote) {
    runCapture("git", ["fetch", remote, "--tags", "--quiet"]);
  }

  const targetSha = git("rev-parse", "--short", ref);
  const currentBranch = git("rev-parse", "--abbrev-ref", "HEAD");
  const branch = inPlace ? currentBranch : getFlagString(flags, "branch", `sync/${targetSha}`);

  if (!inPlace) {
    const createRes = runCapture("git", ["checkout", "-B", branch]);
    if (createRes.status !== 0) {
      const msg = createRes.stderr || createRes.stdout;
      if (json) console.log(JSON.stringify({ ok: false, error: msg }));
      else console.error(msg);
      return 1;
    }
  }

  const rebaseRes = runCapture("git", ["rebase", ref]);
  if (rebaseRes.status === 0) {
    const out = { ok: true, branch, baseRef: ref, baseSha: targetSha, conflicts: [] };
    if (json) console.log(JSON.stringify(out, null, 2));
    else console.log(`✓ Rebased ${branch} cleanly onto ${ref} (${targetSha}).`);
    return 0;
  }

  const conflictedFiles = runCapture("git", ["diff", "--name-only", "--diff-filter=U"])
    .stdout.trim()
    .split("\n")
    .filter(Boolean);

  const conflictContext = conflictedFiles.map((file) => {
    const recentUpstream = runCapture("git", [
      "log",
      "--oneline",
      "-n",
      "5",
      `${currentBranch}..${ref}`,
      "--",
      file,
    ])
      .stdout.trim()
      .split("\n")
      .filter(Boolean);
    return { file, isSidecar: isSidecarFile(file), recentUpstream };
  });

  if (abortOnConflict) {
    runCapture("git", ["rebase", "--abort"]);
    if (!inPlace) {
      runCapture("git", ["checkout", currentBranch]);
    }
  }

  const report = {
    ok: false,
    branch,
    baseRef: ref,
    baseSha: targetSha,
    aborted: abortOnConflict,
    conflicts: conflictContext,
    hint: abortOnConflict
      ? "Rebase aborted cleanly; inspect conflicts above."
      : "Resolve conflicts, run `git add <files> && git rebase --continue`, then `node scripts/fork-sync.ts check`.",
  };

  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.error(`✗ Rebase onto ${ref} (${targetSha}) hit ${conflictedFiles.length} conflict(s):`);
    for (const item of conflictContext) {
      console.error(`  - ${item.file}${item.isSidecar ? " [sidecar]" : " [upstream glue]"}`);
      for (const line of item.recentUpstream) {
        console.error(`      upstream: ${line}`);
      }
    }
    console.error(`\n${report.hint}`);
  }
  return 1;
}

function cmdBuildDesktop(flags: Map<string, string | boolean>) {
  const dmg = flags.get("dmg") === true;
  const archFlag = flags.get("arch");
  const arch = typeof archFlag === "string" ? archFlag : null;

  if (dmg) {
    console.log(`==> Building macOS DMG${arch ? ` (${arch})` : ""}...`);
    return runInherit("node", [
      "scripts/build-desktop-artifact.ts",
      "--platform",
      "mac",
      "--target",
      "dmg",
      ...(arch ? ["--arch", arch] : []),
    ]);
  }

  console.log("==> Building desktop app bundle...");
  return runInherit("vp", ["run", "--filter", "@t3tools/desktop", "--filter", "t3", "build"]);
}

const [, , subcommand = "status", ...rest] = process.argv;
const { flags } = parseFlags(rest);

switch (subcommand) {
  case "status":
    process.exit(cmdStatus(flags));
    break;
  case "check":
    process.exit(cmdCheck(flags));
    break;
  case "rebase":
    process.exit(cmdRebase(flags));
    break;
  case "build-desktop":
    process.exit(cmdBuildDesktop(flags));
    break;
  default:
    console.error(`Unknown command "${subcommand}". Use: status | check | rebase | build-desktop`);
    process.exit(2);
}
