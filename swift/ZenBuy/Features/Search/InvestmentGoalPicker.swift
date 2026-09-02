import SwiftUI

struct InvestmentGoalPicker: View {
    @Binding var selectedId: String
    let directives: [InvestmentDirectiveInfo]
    var onInfo: (InvestmentDirectiveInfo) -> Void

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
                onInfo(directive)
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

    private func pillLabel(_ d: InvestmentDirectiveInfo) -> String {
        switch d.id {
        case "growth_income": return "Growth/Income"
        case "value_income": return "Value/Income"
        default: return d.label
        }
    }
}
