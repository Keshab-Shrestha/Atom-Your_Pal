# Computer decision providers — 24 October 2026

Settings → General → **Computer decisions** now offers **Chat model (default)**, **Jev · cloud**, and **Laya · local**. Keshab requested both so he can choose in Settings. The existing main chat/provider stays primary for task planning and final review; neither option becomes a chat model. Jev has a separate optional Laya backup switch. The default remains the ordinary chat-model path.

## What is implemented

The computer tool adds `choose_sequence` for a genuine branch between **2–4 primary-model-prepared plans**, each containing 1–8 checked button steps. It receives a bounded goal, descriptions and expected labelled values. It validates every candidate using the existing sequence policy before consulting a decision provider. The configured provider chooses an offered plan or `review`; it cannot generate new input or permissions. An accepted index enters the existing `click_sequence` path, with fresh exact-button resolution and whole-window observation/value checks after every click. Unknown/no-op input, mismatches, ownership/generation changes and cancellation retain their existing stops. The main model reviews the final observation.

A latest-look hint states the selected decision provider. The tool instructions reserve the chooser for enabled, genuine branches; a deterministic single plan continues through ordinary checked sequences without an added classifier call. This does not replace all computer reasoning, create a general autonomous local agent, or shorten the driver's click waits.

Conservative initial gates require finite confidence ≥0.95, selected-option probability ≥0.98 and an offered plan index. Laya's full distribution is checked (matching keys, finite normalized probabilities, selected option maximal); the native Jev adapter performs the equivalent response validation. `review` and low-confidence answers go back to the main model **without input**. Jev's valid uncertain answers do not fall through to Laya to seek a different answer. Laya backup is used only when Jev is unavailable/invalid/too slow, and only if selected. These thresholds are provisional engineering gates, not a claim of calibrated accuracy on ATOM tasks.

## Credentials and data

The Jev key field is a native `SecureField`. Save/replace/remove use one app-specific macOS Keychain service/account; only provider/backup preferences go into UserDefaults. The key never goes through the runtime JSON pipe, chat transcript, `.env`, tool schema, logs or model context. It is not displayed or copied back. Removal is a user-confirmed native action and does not revoke the credential at TypeSafe. No real key was entered during implementation.

Selecting Jev shows an explicit data-sharing explanation before it is enabled. Authorized decisions send the current bounded goal, prepared plans, allowed button labels and up to twenty short labelled read-only window values to **TypeSafe**. ATOM does not attach screenshots, editable-field values, full chat history or secret-labelled readings. The goal and proposed plans can themselves contain user-provided task text; selecting Jev is a decision about sharing that task context with another provider, not a claim that all screen text is non-sensitive.

The endpoint is fixed to `https://api.typesafe.ai/v1/systemone`, model alias `jev-latest`, using the documented Choice request/response shape and Bearer authentication. It cannot be changed by a model or page. Native requests use an ephemeral session with no cookie storage/disk cache and reject redirects. A request has a 1.5-second network timeout; the host waits at most 1.8 seconds, cancels by matching UUID, and ignores late results. There is no application retry of Jev requests. The native parser accepts a response up to 32 KB; a bounded context of at most 12 KB is sent. API charges may apply; no prices or end-to-end speed claim are inferred from provider advertising.

Primary references checked on 24 October: [TypeSafe API](https://docs.typesafe.ai/api/system-one), [Choice](https://docs.typesafe.ai/primitives/choice), [confidence semantics](https://docs.typesafe.ai/confidence), [why Jev is not a chat-model replacement](https://docs.typesafe.ai/introduction/coding-agents). Other similarly named third-party Jev sites were not used as integration endpoints.

Laya reuses ATOM's existing Decision Engine/MCP session and installed English checkpoint on MPS. The local process now runs with Hugging Face/Transformers offline flags: missing weights fail instead of downloading. Selecting local Laya, or explicitly enabling it as Jev backup, starts a fictional local-only warm-up, never a desktop read. The next real decision has a 750 ms limit and cancellation; cold, failed or uncertain results return to the main model. Existing worker tier selection, role floors, pins and cloud chat defaults remain unchanged.

## Local installation repair

The existing `~/laya/.venv/bin/python3.14` pointed to removed Homebrew Python **3.14.7**, causing immediate ENOENT startup failures. Updated only that virtual environment's interpreter symlink to the existing stable Homebrew Python 3.14 path and its `pyvenv.cfg` version/home/executable entries. No packages, interpreter, weights or general-purpose local model were installed/downloaded. Python **3.14.8**, Torch **2.14.0** and Laya **0.3.20** import successfully.

Recovery copies were retained beside the originals:

- `~/laya/.venv/bin/python3.14.atom-before-20261024`
- `~/laya/.venv/pyvenv.cfg.atom-before-20261024`

Restoring those copies restores the old configuration, including its broken interpreter target. The repair is local machine state outside Git.

## Verification and limits

Native release compilation and strict bundle signature verification pass; the rebuilt app is running. The actual General page shows all three choices and the masked key field; a visual inspection confirmed the layout. The Jev sharing explanation was opened and declined; no Jev account, key or request was used. A temporary local-Laya selection survived relaunch and invoked the host decider; it was returned to Chat model (default) after verification so the user chooses the active provider.

Actual local MCP timing on a fictional addition/subtraction choice: helper startup **5,875 ms**, first inference **1,966 ms**, repeat inference **54 ms** (server reported MPS). It picked the expected option with probability **0.8714**, confidence **0.5803**; ATOM correctly rejects that as insufficient for automatic execution. The live app's first selection attempt hit its short **753 ms** limit and sent **no input** (request `CFFBC919-8308-47DE-B8F6-7B73F7267D42`, 28.345-second overall planning/reporting turn). Calculator remained `13 + 2`, independently observed; no ambiguous result was replayed. This motivated explicit inference warm-up. Its next app launch logged helper ready in **7,177 ms** and warm-up completion 2.407 seconds later.

The warmed live request `0683B10D-6964-458E-96F8-1B3E51B4BF59` invoked Laya in **509 ms**, declined automatic selection, and sent no input (19.697-second overall planning/reporting turn). An independent native inspection still showed `13 + 2`. Both live routes exercised safe abstention; automatic execution after an accepted Laya/Jev choice has focused integration coverage with a fake selector, not a successful real-provider task in this acceptance. Later wording distinguishes an uncertain choice from an unavailable provider, with metadata-only reasons; it does not expose state or credentials. A fast isolated classifier response is not evidence that a whole computer task became faster or that the confidence gates are calibrated. Jev network/credential acceptance and a broad task-speed/accuracy comparison remain open until a real key is entered locally and representative tasks are measured. Typecheck and all **172 focused TypeScript tests** pass. No Swift test suite was run; focused checks cover parsing, preflight of every plan, chosen-plan-only execution, no-input uncertain/cancelled selection, UUID/config-change cancellation and existing sequence/permission regressions.

Reproduce focused checks:

```sh
pnpm typecheck
node --test --test-reporter=spec services/decision-engine/src/*.test.ts services/tool-engine/src/computer/tool.test.ts services/tool-engine/src/computer/sequence.test.ts apps/mac/src/computer-bridge.test.ts apps/mac/src/island-protocol.test.ts
codesign --verify --deep --strict apps/mac/island/build/ATOM.app
git diff --check
```

To disable, choose Chat model (default); the existing individual/checked-sequence path remains. Removing the provider chooser/bridge/optional engine method does not require a chat or permission migration. Do not remove other earlier workflow fixes. No commit or push was performed. Cursor visual acceptance remains deferred.
