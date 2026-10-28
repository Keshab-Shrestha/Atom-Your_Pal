import Testing
@testable import AtomIslandCore

/// The Needs you filters (the HTML preview's chips): which waiting things each one shows, and its count.
struct NeedsYouFilterTests {
    private func item(_ kind: NeedsYouItem.Kind, _ id: String = "x") -> NeedsYouItem {
        NeedsYouItem(id: id, kind: kind, helperId: "h", helperName: "H", title: "t", detail: "d", jobId: nil)
    }

    @Test func theFiltersReadInTheOrderOfTheChips() {
        #expect(NeedsYouFilter.allCases.map(\.title) == ["All", "Approvals", "Plans", "Suggestions", "Held", "Failed"])
    }

    @Test func eachKindBelongsToExactlyOneGroup() {
        let groups: [(NeedsYouItem.Kind, NeedsYouFilter)] = [
            (.plan, .plans), (.proposal, .suggestions), (.skillDraft, .suggestions), (.skillEdit, .suggestions),
            (.skillHub, .suggestions), (.held, .held), (.failed, .failed),
        ]
        for (kind, group) in groups {
            let owners = NeedsYouFilter.allCases.filter { $0 != .all && $0.matches(kind) }
            #expect(owners == [group], "\(kind) belongs to \(group) only")
            #expect(NeedsYouFilter.all.matches(kind))
        }
    }

    @Test func approvalsAndFailuresHaveTheirOwnSections() {
        #expect(NeedsYouFilter.all.showsApproval && NeedsYouFilter.approvals.showsApproval)
        #expect(!NeedsYouFilter.plans.showsApproval && !NeedsYouFilter.failed.showsApproval)
        #expect(NeedsYouFilter.all.showsFailed && NeedsYouFilter.failed.showsFailed)
        #expect(!NeedsYouFilter.approvals.showsFailed && !NeedsYouFilter.held.showsFailed)
    }

    @Test func theCountsFollowTheGroups() {
        let items = [item(.plan, "a"), item(.plan, "b"), item(.proposal, "c"), item(.skillHub, "d"), item(.held, "e")]
        let counts = NeedsYouFilter.counts(items: items, failed: 2, hasApproval: true)
        #expect(counts[.approvals] == 1 && counts[.plans] == 2 && counts[.suggestions] == 2 && counts[.held] == 1 && counts[.failed] == 2)
        #expect(counts[.all] == 8, "All counts the approval, every waiting item and every failed task once")
        let none = NeedsYouFilter.counts(items: [], failed: 0, hasApproval: false)
        #expect(NeedsYouFilter.allCases.allSatisfy { none[$0] == 0 })
    }

    @Test func aFailedItemInTheListIsNotCountedTwice() {
        // The pane lists failed tasks apart (ADR-116); a failed item that reaches the list is counted by `failed` only.
        let counts = NeedsYouFilter.counts(items: [item(.plan), item(.failed)], failed: 1, hasApproval: false)
        #expect(counts[.failed] == 1 && counts[.all] == 2)
    }
}
