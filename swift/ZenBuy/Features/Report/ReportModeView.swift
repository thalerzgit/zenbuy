import SwiftUI

/// Full-screen report-style chooser (not a sheet).
struct ReportModeView: View {
    let picks: [SymbolResult]
    let onSelect: (ReportMode) -> Void

    @State private var mode: ReportMode = .separate

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("How should we analyze these?")
                .font(.title2.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.ink)

            Text("You selected \(picks.map(\.symbol).joined(separator: ", ")).")
                .font(.subheadline)
                .foregroundStyle(ZenBuyTheme.muted)

            VStack(spacing: 10) {
                modeCard(
                    title: "Separate reports",
                    subtitle: "One full report per company.",
                    value: .separate
                )
                modeCard(
                    title: "Comparative report",
                    subtitle: "Rank names and pick the best fit.",
                    value: .comparative
                )
            }

            Spacer()

            Button("Continue") {
                onSelect(mode)
            }
            .buttonStyle(.borderedProminent)
            .tint(ZenBuyTheme.sage)
            .frame(maxWidth: .infinity)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ZenBuyTheme.background)
        .navigationTitle("Report style")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func modeCard(title: String, subtitle: String, value: ReportMode) -> some View {
        let selected = mode == value
        return Button {
            mode = value
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(selected ? ZenBuyTheme.sage : ZenBuyTheme.muted)
                    .font(.title3)
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(ZenBuyTheme.ink)
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundStyle(ZenBuyTheme.muted)
                }
                Spacer()
            }
            .padding(14)
            .background(selected ? ZenBuyTheme.sageLight : ZenBuyTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(selected ? ZenBuyTheme.sage : ZenBuyTheme.border, lineWidth: selected ? 2 : 1)
            )
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    NavigationStack {
        ReportModeView(picks: [
            SymbolResult(symbol: "AAPL", name: "Apple Inc"),
            SymbolResult(symbol: "MSFT", name: "Microsoft Corp"),
        ]) { _ in }
    }
}
