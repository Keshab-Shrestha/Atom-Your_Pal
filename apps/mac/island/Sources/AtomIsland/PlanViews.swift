import SwiftUI
import AtomIslandCore

// ADR-111: a work plan in the notch (one dot a portion) and on the Board (a card with each portion).

/// One dot a portion: grey waits, the live colour works, green is done, red failed.
struct PlanDots: View {
    let plan: WorkPlanItem
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 4) {
            ForEach(plan.portions) { portion in
                Circle()
                    .fill(color(portion.state))
                    .frame(width: 7, height: 7)
                    .opacity(portion.state == .waiting ? 0.55 : 1)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Plan: \(plan.summary)")
    }

    private func color(_ state: PlanPortion.State) -> Color {
        switch state {
        case .done: return theme.success.color
        case .running: return theme.live.color
        case .failed, .stopped, .blocked: return theme.problem.color
        case .waiting: return theme.text3.color
        }
    }
}

/// The Board's plan card: the goal, how far it is, and one line a portion. A portion with a task opens it.
struct PlanCard: View {
    let model: IslandModel
    let plan: WorkPlanItem
    @Environment(\.theme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: theme.radiusCard, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(plan.goal).font(.system(size: 13, weight: .semibold)).foregroundStyle(theme.text.color).lineLimit(2)
                    Text(plan.summary).font(.system(size: 11)).foregroundStyle(plan.stuck ? theme.problem.color : theme.text3.color)
                }
                Spacer(minLength: 8)
                PlanDots(plan: plan)
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            ForEach(plan.portions) { portion in
                Rectangle().fill(theme.separator.color).frame(height: theme.isFlat ? 1 : 0.5)
                PlanPortionRow(model: model, plan: plan, portion: portion)
            }
        }
        .background(shape.fill(theme.fill1.color))
        .overlay(shape.strokeBorder(theme.separator.color, lineWidth: theme.isFlat ? 1 : 0.5))
        .accessibilityElement(children: .contain)
    }
}

private struct PlanPortionRow: View {
    let model: IslandModel
    let plan: WorkPlanItem
    let portion: PlanPortion
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("P\(portion.n)").font(theme.idFont(.system(size: 11), size: 10.5)).foregroundStyle(theme.text3.color).frame(width: 24, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(portion.task).font(.system(size: 12.5)).foregroundStyle(theme.text.color).lineLimit(2)
                Text("\(portion.name) · \(portion.stateText(portions: plan.portions))")
                    .font(.system(size: 11)).foregroundStyle(portion.state == .failed || portion.state == .blocked ? theme.problem.color : theme.text3.color)
            }
            Spacer(minLength: 8)
            if let job = portion.job {
                QuietButton(title: portion.state == .done ? "Report" : "Open") { model.navigate { model.sendHelpers(model.helpers.openThread(job)) } }
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 9)
    }
}
