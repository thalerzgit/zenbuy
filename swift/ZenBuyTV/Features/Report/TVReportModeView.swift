import SwiftUI

struct TVReportModeView: View {
    let picks: [SymbolResult]
    let onSelect: (ReportMode) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: TVTheme.stackSpacing) {
            Text("How should we analyze these?")
                .font(TVTheme.titleFont)
                .foregroundStyle(ZenBuyTheme.ink)

            Text("You selected \(picks.map(\.symbol).joined(separator: ", ")).")
                .font(TVTheme.bodyFont)
                .foregroundStyle(ZenBuyTheme.muted)
                .fixedSize(horizontal: false, vertical: true)

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
            .tvFocusRow()
        }
        .padding(TVTheme.pagePadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(ZenBuyTheme.background.ignoresSafeArea())
    }

    private func modeCard(title: String, subtitle: String, value: ReportMode) -> some View {
        Button {
            onSelect(value)
        } label: {
            VStack(alignment: .leading, spacing: 12) {
                Text(title)
                    .font(TVTheme.cardTitleFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(subtitle)
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .buttonStyle(.tvCard(minHeight: TVTheme.intentCardMinHeight))
    }
}
