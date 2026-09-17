import SwiftUI

struct TVDirectiveDetailView: View {
    let directive: InvestmentDirectiveInfo

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text(directive.label)
                    .font(TVTheme.titleFont)
                    .foregroundStyle(ZenBuyTheme.ink)
                Text(directive.headline)
                    .font(TVTheme.headlineFont)
                    .foregroundStyle(ZenBuyTheme.sageDark)
                Text(directive.detailProfile ?? directive.plainEnglish)
                    .font(TVTheme.bodyFont)
                    .foregroundStyle(ZenBuyTheme.muted)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 28) {
                    stat("Wait", directive.horizon)
                    stat("Risk", directive.risk)
                    stat("Income", directive.incomeFocus)
                }

                Text("Example: \(directive.exampleGoal)")
                    .font(TVTheme.captionFont)
                    .foregroundStyle(ZenBuyTheme.muted)
            }
            .padding(TVTheme.pagePadding)
            .frame(maxWidth: 1100, alignment: .leading)
        }
        .background(ZenBuyTheme.background)
    }

    private func stat(_ title: String, _ value: String) -> some View {
        TVFocusCard(selected: false) {
            VStack(alignment: .leading, spacing: 8) {
                Text(title.uppercased())
                    .font(TVTheme.captionFont.weight(.semibold))
                    .foregroundStyle(ZenBuyTheme.muted)
                Text(value)
                    .font(TVTheme.headlineFont)
                    .foregroundStyle(ZenBuyTheme.ink)
            }
        }
        .frame(maxWidth: 260)
    }
}
