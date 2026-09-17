import SwiftUI

struct TVDirectiveDetailView: View {
    let directive: InvestmentDirectiveInfo

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: TVTheme.stackSpacing) {
                Text(directive.label)
                    .font(TVTheme.titleFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                Text(directive.headline)
                    .font(TVTheme.cardTitleFont)
                    .foregroundStyle(ZenBuyTheme.greenDark)
                    .fixedSize(horizontal: false, vertical: true)
                Text(directive.detailProfile ?? directive.plainEnglish)
                    .font(TVTheme.bodyFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(alignment: .top, spacing: TVTheme.columnGap) {
                    stat("Wait", directive.horizon)
                    stat("Risk", directive.risk)
                    stat("Income", directive.incomeFocus)
                }

                Text("Example: \(directive.exampleGoal)")
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(TVTheme.pagePadding)
            .frame(maxWidth: TVTheme.readingMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .center)
        }
        .background(ZenBuyTheme.background.ignoresSafeArea())
    }

    private func stat(_ title: String, _ value: String) -> some View {
        TVCardSurface {
            VStack(alignment: .leading, spacing: 10) {
                Text(title.uppercased())
                    .font(TVTheme.eyebrowFont)
                    .foregroundStyle(ZenBuyTheme.muted)
                Text(value)
                    .font(TVTheme.cardTitleFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: 380)
    }
}
