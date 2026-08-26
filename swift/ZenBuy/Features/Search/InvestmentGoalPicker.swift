import SwiftUI

struct InvestmentGoalPicker: View {
    @Binding var selectedId: String
    let directives: [InvestmentDirectiveInfo]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("What's your investing goal?")
                .font(.headline)
                .foregroundStyle(ZenBuyTheme.ink)

            Text(
                "Pick the style that matches how long you can wait and how much risk feels OK. We'll tailor every report to that."
            )
            .font(.footnote)
            .foregroundStyle(ZenBuyTheme.muted)
            .fixedSize(horizontal: false, vertical: true)

            ForEach(directives) { directive in
                Button {
                    selectedId = directive.id
                } label: {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(directive.label)
                                .font(.subheadline.weight(.semibold))
                                .foregroundStyle(ZenBuyTheme.sageDark)
                            Text(directive.headline)
                                .font(.caption)
                                .foregroundStyle(ZenBuyTheme.muted)
                                .lineLimit(2)
                            Spacer(minLength: 0)
                            if selectedId == directive.id {
                                Image(systemName: "checkmark.circle.fill")
                                    .foregroundStyle(ZenBuyTheme.sage)
                            }
                        }

                        Text("Best if: \(directive.bestIf)")
                            .font(.caption)
                            .foregroundStyle(ZenBuyTheme.muted)
                            .multilineTextAlignment(.leading)

                        Text(directive.plainEnglish)
                            .font(.caption)
                            .foregroundStyle(ZenBuyTheme.muted)
                            .multilineTextAlignment(.leading)

                        HStack(alignment: .top, spacing: 12) {
                            statBlock(title: "Typical wait", value: directive.horizon)
                            statBlock(title: "Risk", value: directive.risk)
                            statBlock(title: "Income", value: directive.incomeFocus)
                        }

                        Text("Example: \(directive.exampleGoal)")
                            .font(.caption2)
                            .foregroundStyle(ZenBuyTheme.muted)
                            .multilineTextAlignment(.leading)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        selectedId == directive.id
                            ? ZenBuyTheme.sageLight
                            : ZenBuyTheme.background
                    )
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(
                                selectedId == directive.id ? ZenBuyTheme.sage : ZenBuyTheme.border,
                                lineWidth: selectedId == directive.id ? 2 : 1
                            )
                    )
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder
    private func statBlock(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.muted)
            Text(value)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.ink)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
