// Part of the `agent-skills` feature. Configuration for scripts/agent-skills.js, read from
// the repo root.
//
//   pnpm skills:sync    write the selected skills into each agent's skill folder
//   pnpm skills:check   fail if a skill folder differs from what sync would write
//
// Run `pnpm skills:sync` after each change to this file.

export default {
    // The kinds of package this workspace holds, or will hold. Each type selects the
    // skills for it, on top of the skills every workspace gets. An empty list selects
    // only those.
    //
    //   "service"        an app, an HTTP API, a worker, or a CLI
    //   "frontend"       a browser app, for example one with Effect Atom
    //   "internal-lib"   a library that only this workspace uses
    //   "published-lib"  a library published to npm
    //
    // Example: packageTypes: ["service", "internal-lib"],
    packageTypes: ["service", "published-lib"],

    // The agents to write skills for. "claude" writes .claude/skills/, and "codex"
    // writes .agents/skills/. Each folder gets its own copy.
    agents: ["claude"],
};
