import SwiftUI

/// 10-foot living-room tokens. Color still comes from `ZenBuyTheme`.
enum TVTheme {
    static let pagePadding: CGFloat = 72
    static let columnGap: CGFloat = 36
    static let cardRadius: CGFloat = 22
    static let cardPadding: CGFloat = 28
    static let stackSpacing: CGFloat = 22

    static let titleFont = Font.largeTitle.weight(.bold)
    static let headlineFont = Font.title2.weight(.semibold)
    static let bodyFont = Font.title3
    static let captionFont = Font.headline
}

struct TVFocusCard<Content: View>: View {
    var selected: Bool = false
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .padding(TVTheme.cardPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? ZenBuyTheme.sageLight : ZenBuyTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous)
                    .stroke(selected ? ZenBuyTheme.sage : ZenBuyTheme.border, lineWidth: selected ? 4 : 2)
            )
    }
}
