import SwiftUI

/// Step 1 of the search wizard — Find vs Analyze. Replaces the old top
/// Enter/Find ticker tabs so intent is answered before tickers appear.
struct PathIntentCards: View {
    let selected: SearchInputMode?
    var onSelect: (SearchInputMode) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("What's your goal?")
                .font(.title3.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.ink)
                .accessibilityAddTraits(.isHeader)

            VStack(spacing: 10) {
                card(
                    mode: .find,
                    title: "Find stocks",
                    subtitle: "We'll suggest names that match your style and time window."
                )
                card(
                    mode: .enter,
                    title: "Analyze stocks you have in mind",
                    subtitle: "Enter tickers or company names you already know."
                )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("What's your goal?")
    }

    @ViewBuilder
    private func card(mode: SearchInputMode, title: String, subtitle: String) -> some View {
        let isSelected = selected == mode
        Button {
            onSelect(mode)
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.headline)
                    .foregroundStyle(isSelected ? ZenBuyTheme.sageDark : ZenBuyTheme.ink)
                Text(subtitle)
                    .font(.subheadline)
                    .foregroundStyle(ZenBuyTheme.muted)
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(isSelected ? ZenBuyTheme.sageLight : ZenBuyTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(isSelected ? ZenBuyTheme.sage : ZenBuyTheme.border, lineWidth: isSelected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}
