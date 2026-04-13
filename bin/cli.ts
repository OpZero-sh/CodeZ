#!/usr/bin/env bun

const args = process.argv.slice(2);
const cmd = args[0];

async function main() {
  if (cmd === "serve" || cmd === "start") {
    const { spawn } = await import("child_process");
    const child = spawn("bun", ["run", "server/index.ts"], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => process.exit(code ?? 0));
  } else if (cmd === "init") {
    const { spawn } = await import("child_process");
    const child = spawn("bash", ["scripts/init.sh"], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => process.exit(code ?? 0));
  } else if (cmd === "version" || cmd === "--version" || cmd === "-v") {
    const pkg = JSON.parse(await Bun.file("package.json").text());
    console.log(pkg.version ?? "0.0.0");
  } else if (!cmd) {
    console.log("Usage: codez <command>");
    console.log("");
    console.log("Commands:");
    console.log("  serve, start   Run the server");
    console.log("  init           Interactive setup");
    console.log("  version        Show version");
    process.exit(1);
  } else {
    console.log(`Unknown command: ${cmd}`);
    process.exit(1);
  }
}

main();