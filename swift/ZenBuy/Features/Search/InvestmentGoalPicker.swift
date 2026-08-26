import SwiftUI

struct InvestmentGoalPicker: View {
    @Binding var selectedId: String
    let directives: [InvestmentDirectiveInfo]
    @State private var detailDirective: InvestmentDirectiveInfo?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What's your goal?")
                .font(.headline)
                .foregroundStyle(ZenBuyTheme.ink)

            Text("Tap a strategy — i for details.")
                .font(.footnote)
                .foregroundStyle(ZenBuyTheme.muted)

            FlowLayout(spacing: 8) {
                ForEach(directives) { directive in
                    pill(for: directive)
                }
            }
        }
        .sheet(item: $detailDirective) { d in
            detailSheet(d)
        }
    }

    @ViewBuilder
    private func pill(for directive: InvestmentDirectiveInfo) -> some View {
        let selected = selectedId == directive.id
        HStack(spacing: 6) {
            Button {
                selectedId = directive.id
            } label: {
                Text(pillLabel(directive))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(selected ? ZenBuyTheme.sageDark : ZenBuyTheme.muted)
            }
            .buttonStyle(.plain)

            Button {
                detailDirective = directive
            } label: {
                Text("i")
                    .font(.caption2.weight(.bold))
                    .italic()
                    .foregroundStyle(ZenBuyTheme.muted)
                    .frame(width: 18, height: 18)
                    .background(ZenBuyTheme.background)
                    .clipShape(Circle())
                    .overlay(Circle().stroke(ZenBuyTheme.border, lineWidth: 1))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("About \(directive.label)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(selected ? ZenBuyTheme.sageLight : ZenBuyTheme.background)
        .clipShape(Capsule())
        .overlay(
            Capsule().stroke(selected ? ZenBuyTheme.sage : ZenBuyTheme.border, lineWidth: selected ? 2 : 1)
        )
    }

    @ViewBuilder
    private func detailSheet(_ d: InvestmentDirectiveInfo) -> some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    Text(d.headline)
                        .font(.subheadline.weight(.semibold))
                    Text(d.detailProfile ?? d.plainEnglish)
                        .font(.body)
                        .foregroundStyle(ZenBuyTheme.muted)
                    HStack(spacing: 16) {
                        statBlock(title: "Wait", value: d.horizon)
                        statBlock(title: "Risk", value: d.risk)
                        statBlock(title: "Income", value: d.incomeFocus)
                    }
                    Text("Example: \(d.exampleGoal)")
                        .font(.footnote)
                        .foregroundStyle(ZenBuyTheme.muted)
                }
                .padding()
            }
            .navigationTitle(d.label)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { detailDirective = nil }
                }
            }
        }
        .presentationDetents([.medium])
    }

    private func pillLabel(_ d: InvestmentDirectiveInfo) -> String {
        switch d.id {
        case "growth_income": return "Growth/Income"
        case "value_income": return "Value/Income"
        default: return d.label
        }
    }

    @ViewBuilder
    private func statBlock(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.muted)
            Text(value)
                .font(.caption.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.ink)
        }
    }
}

/// Simple horizontal flow for pill chips.
private struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = arrange(proposal: proposal, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = arrange(proposal: proposal, subviews: subviews)
        for (index, frame) in result.frames.enumerated() {
            subviews[index].place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> (size: CGSize, frames: [CGRect]) {
        let maxWidth = proposal.width ?? .infinity
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var frames: [CGRect] = []

        for subview in subviews {
            let size = subview.sizeThatFits(.unspecified)
            if x + size.width > maxWidth, x > 0 {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(origin: CGPoint(x: x, y: y), size: size))
            rowHeight = max(rowHeight, size.height)
            x += size.width + spacing
        }

        return (CGSize(width: maxWidth, height: y + rowHeight), frames)
    }
}
