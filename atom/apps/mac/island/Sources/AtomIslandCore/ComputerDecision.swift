import Foundation

public struct ComputerDecisionRequest: Decodable, Equatable, Sendable {
    public let id: String
    public let state: String
    public let criteria: [String: String]
    public var valid: Bool {
        UUID(uuidString: id) != nil && state.utf8.count <= 12_000 && (3...5).contains(criteria.count)
        && criteria["review"] != nil && criteria.allSatisfy { key, value in
            (key == "review" || ["plan_0", "plan_1", "plan_2", "plan_3"].contains(key)) && !value.isEmpty && value.count <= 300
        }
    }
}
