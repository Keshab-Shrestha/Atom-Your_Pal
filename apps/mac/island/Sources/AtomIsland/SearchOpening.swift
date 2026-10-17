import AtomIslandCore

// Opening one row of the search results: by click or by Return (upgrades.md C1). Each row opens the place that holds it.

extension IslandModel {
    func openSearchEntry(_ entry: SearchEntry) {
        switch entry.kind {
        case .chat:
            guard let id = entry.hit?.id else { return }
            navigate {
                if id != self.chats?.current { self.send(.chatOpen(id: id)) }
                self.windowPage = .chat
            }
        case .task, .report:
            // A task older than the Board shows cannot open.
            guard let id = entry.hit?.taskId, helpers.list?.item(id) != nil else { return }
            navigate {
                self.windowPage = .agents
                self.sendHelpers(self.helpers.openThread(id))
            }
        case .other(let kind):
            guard let id = entry.hit?.id else { return }
            navigate {
                switch kind {
                case .pages:
                    self.windowPage = .brain
                    self.selectBrainNote(Int(id))
                case .facts, .notes:
                    self.windowPage = .brain // Memory is part of the Second brain page
                case .projects:
                    self.newChat(inProject: id)
                    self.windowPage = .chat
                case .agents:
                    self.windowPage = .agents
                    self.helpers.selectHelper(id)
                case .skills:
                    self.windowPage = .plugins
                case .routines:
                    self.windowPage = .scheduled
                }
            }
        case .settings:
            guard let page = entry.page else { return }
            navigate { self.openSettings(page) }
        }
    }

    /// Whether a row can open now (a task older than the Board shows cannot).
    func canOpenSearchEntry(_ entry: SearchEntry) -> Bool {
        switch entry.kind {
        case .task, .report: entry.hit?.taskId.flatMap { helpers.list?.item($0) } != nil
        default: true
        }
    }
}
