import SwiftUI

struct TVOnboardingView: View {
    var onContinue: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 56) {
            VStack(alignment: .leading, spacing: 28) {
                ZenBuyBrandHeader(onDark: false)
                    .scaleEffect(1.15, anchor: .leading)

                Text("Stock research on the big screen.")
                    .font(TVTheme.titleFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                Text("Use the Siri Remote to move between cards. Click to select. Type a ticker or let ZenBuy find names that match your goal.")
                    .font(TVTheme.bodyFont)
                    .foregroundStyle(ZenBuyTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: 720, alignment: .leading)

                Button("Continue") {
                    onContinue()
                }
                .buttonStyle(.borderedProminent)
                .tint(ZenBuyTheme.sage)
                .font(TVTheme.headlineFont)
            }
            .frame(maxWidth: 820, alignment: .leading)

            VStack(alignment: .leading, spacing: 18) {
                hint(icon: "magnifyingglass", title: "Find or enter tickers", detail: "Search by symbol, or ask ZenBuy to pick names.")
                hint(icon: "chart.line.uptrend.xyaxis", title: "Run research", detail: "Same Grok-first reports as iPhone and zenbuy.info.")
                hint(icon: "text.justify.left", title: "Read on the sofa", detail: "Bottom line first, then the full stream.")
            }
            .frame(maxWidth: 560)
        }
        .padding(TVTheme.pagePadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(ZenBuyTheme.background)
    }

    private func hint(icon: String, title: String, detail: String) -> some View {
        TVFocusCard(selected: false) {
            HStack(alignment: .top, spacing: 20) {
                Image(systemName: icon)
                    .font(.largeTitle)
                    .foregroundStyle(ZenBuyTheme.sage)
                    .frame(width: 56)
                VStack(alignment: .leading, spacing: 8) {
                    Text(title)
                        .font(TVTheme.headlineFont)
                        .foregroundStyle(ZenBuyTheme.ink)
                    Text(detail)
                        .font(TVTheme.captionFont)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}
