import SwiftUI

struct DirectiveDetailView: View {
    let directive: InvestmentDirectiveInfo

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(directive.headline)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(ZenBuyTheme.ink)
                Text(directive.detailProfile ?? directive.plainEnglish)
                    .font(.body)
                    .foregroundStyle(ZenBuyTheme.muted)
                HStack(spacing: 16) {
                    statBlock(title: "Wait", value: directive.horizon)
                    statBlock(title: "Risk", value: directive.risk)
                    statBlock(title: "Income", value: directive.incomeFocus)
                }
                Text("Example: \(directive.exampleGoal)")
                    .font(.footnote)
                    .foregroundStyle(ZenBuyTheme.muted)
            }
            .padding(20)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(ZenBuyTheme.background)
        .navigationTitle(directive.label)
        // Apple TV browses directives through TVDirectiveDetailView, so this
        // screen is iOS-only — but the modifier does not exist on tvOS, so it
        // stays fenced rather than breaking the TV target if the file is ever
        // shared. See docs/TVOS_TESTFLIGHT.md.
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }

    @ViewBuilder
    private func statBlock(title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title.uppercased())
                .font(.caption2.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.muted)
            Text(value)
                .font(.caption.weight(.semibold))
                .foregroundStyle(ZenBuyTheme.ink)
        }
    }
}
