# ATOM backend boundary

This branch uses T3 Code's source snapshot `441a4ebd65543fa414797253eb31cc02f8811e32` as its client and chat foundation. Its React chat, motion, reasoning timeline, client state, WebSocket contracts, durable orchestration and Electron wrapper remain upstream implementations. The MIT notice remains in the root license.

ATOM's backend snapshot from `a578162` is under `atom/`, with its own workspace and dependencies. Keeping these workspaces separate avoids conflating the two projects' contracts and package versions. Its previous SwiftUI interface is retained as source, but is not launched by the new entry point.

T3's local ACP provider connects through a stdio proxy to one ATOM backend owner over a private Unix socket. A provider connection does not start another runtime or open the databases. ATOM serializes foreground requests around its current Core, resumes the selected chat before each turn, and keeps its memory, project grants, tool policy and approval authority. T3 owns the conversation presentation and its projections. Removing T3's chat server would also remove the stream and recovery machinery the new interface depends on.

Only displayable provider reasoning enters ACP `agent_thought_chunk`; host activity does not become invented thinking text. Codex's raw reasoning payload is not forwarded. Access changes reach ATOM's existing controls, and enabling Full access requires a separate ATOM confirmation. Dropping a connection aborts its work and refuses pending approvals.

The new backend uses this checkout's `atom/data` and `atom/config`; the client uses `.atom-t3/userdata`. Existing installed ATOM and T3 data are not automatically opened, copied or migrated. An old ATOM chat has no T3 projection merely because its database exists. History import and reconciling the two stores require a deliberate migration before switching an existing installation.

This initial adapter accepts text prompts. Attachments, background task delivery, question cards, ATOM-specific settings/pages and packaging the native capability helpers into the new desktop distribution still require integration. Unsupported prompt blocks are refused explicitly. The macOS backend and Unix transport do not establish Windows support; remote clients can use the T3 environment hosting that backend. Existing T3 providers remain in source, while fresh ATOM launcher settings select ATOM and disable T3's two default direct providers.
