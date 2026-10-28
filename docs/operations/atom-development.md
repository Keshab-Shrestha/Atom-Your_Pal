# Run the ATOM backend with T3 chat

Install the root T3 workspace dependencies, then the independent backend dependencies:

```sh
pnpm install --ignore-scripts
pnpm --dir atom install --ignore-scripts
```

Use the Node version required by the root package. Native desktop dependencies may need their upstream build/install steps before Electron can run.

```sh
pnpm atom:dev
```

This configures an ATOM local ACP provider in the checkout's `.atom-t3` home, starts one ATOM backend, then starts T3 web/server without copying an installed T3 database. Open the address printed by the T3 development runner. The launcher keeps existing isolated settings and refreshes only the ATOM provider's executable paths.

`pnpm atom:desktop` selects the upstream Electron development surface. `pnpm atom:backend` starts only the backend. `pnpm atom:setup` updates isolated provider configuration without starting a runtime. These commands do not install or replace the running native ATOM app.

The backend discovers signed-in Claude, Codex and Gemini programs using ATOM's existing configuration. Optional backend environment values belong in `atom/.env`, which is ignored. Do not copy credentials into provider command arguments or source files.

Closing the launcher stops only its own child processes. If another runtime owns this backend's data, startup refuses to proceed; do not delete the lock or kill a process by name. Stop the owning instance first. The ATOM provider's connection error means its backend needs to be started, rather than that provider credentials are necessarily wrong.
