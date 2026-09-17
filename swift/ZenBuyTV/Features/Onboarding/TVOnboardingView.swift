import SwiftUI

struct TVOnboardingView: View {
    var onStart: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 56) {
            VStack(alignment: .leading, spacing: 26) {
                ZenBuyBrandHeader(onDark: false)

                Text("Stock research on the big screen.")
                    .font(TVTheme.heroFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Use the Siri Remote to move between cards. Clicking a card selects it and moves straight on — there is nothing else to press.")
                    .font(TVTheme.bodyFont)
                    .foregroundStyle(ZenBuyTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)

                Button("Start") {
                    onStart()
                }
                .buttonStyle(.tvPrimary)
                .padding(.top, 8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            VStack(alignment: .leading, spacing: 20) {
                hint(
                    icon: "magnifyingglass",
                    title: "Find or enter tickers",
                    detail: "Search by symbol, or ask ZenBuy to pick names."
                )
                hint(
                    icon: "chart.line.uptrend.xyaxis",
                    title: "Run research",
                    detail: "Same Grok-first reports as iPhone and zenbuy.info."
                )
                hint(
                    icon: "text.justify.left",
                    title: "Read on the sofa",
                    detail: "Bottom line first, then the full stream."
                )
            }
            .frame(width: TVTheme.hintColumnWidth, alignment: .leading)
        }
        .padding(TVTheme.pagePadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(ZenBuyTheme.background.ignoresSafeArea())
    }

    private func hint(icon: String, title: String, detail: String) -> some View {
        TVCardSurface {
            HStack(alignment: .top, spacing: 20) {
                Image(systemName: icon)
                    .font(.system(size: 38, weight: .semibold))
                    .foregroundStyle(ZenBuyTheme.green)
                    .frame(width: 52, alignment: .leading)
                VStack(alignment: .leading, spacing: 8) {
                    Text(title)
                        .font(TVTheme.cardTitleFont)
                        .foregroundStyle(ZenBuyTheme.ink)
                        .lineLimit(2)
                        .minimumScaleFactor(0.8)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(detail)
                        .font(TVTheme.captionFont)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
