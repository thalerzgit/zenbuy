import SwiftUI

struct TVReportModeView: View {
    let picks: [SymbolResult]
    let onSelect: (ReportMode) -> Void
    @State private var mode: ReportMode = .separate

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            Text("How should we analyze these?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            Text("You selected \(picks.map(\.symbol).joined(separator: ", ")).")
                .font(TVTheme.bodyFont)
                .foregroundStyle(ZenBuyTheme.muted)

            HStack(alignment: .top, spacing: TVTheme.columnGap) {
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

            Button("Continue") {
                onSelect(mode)
            }
            .buttonStyle(.borderedProminent)
            .tint(ZenBuyTheme.sage)
            .font(TVTheme.headlineFont)
        }
        .padding(TVTheme.pagePadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ZenBuyTheme.background)
    }

    private func modeCard(title: String, subtitle: String, value: ReportMode) -> some View {
        Button {
            mode = value
        } label: {
            TVFocusCard(selected: mode == value) {
                VStack(alignment: .leading, spacing: 12) {
                    Text(title)
                        .font(TVTheme.headlineFont)
                        .foregroundStyle(ZenBuyTheme.ink)
                    Text(subtitle)
                        .font(TVTheme.captionFont)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .buttonStyle(.card)
    }
}
