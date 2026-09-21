import SwiftUI

/// 10-foot living-room tokens for the Apple TV target only. Color still comes
/// from `ZenBuyTheme`; sizes are explicit because tvOS has no Dynamic Type and
/// the semantic styles are outsized on a 1920×1080 point canvas — `.title2`
/// (48pt) titles truncated inside grid cells and hyphenated single words.
enum TVTheme {
    // Layout. Usable width is 1740 after the tvOS overscan inset, so a page
    // padding of 64 leaves 1612 for content.
    static let pagePadding: CGFloat = 64
    static let columnGap: CGFloat = 32
    static let cardRadius: CGFloat = 24
    static let cardPadding: CGFloat = 30
    static let stackSpacing: CGFloat = 24
    static let goalCardMinHeight: CGFloat = 230
    static let intentCardMinHeight: CGFloat = 200
    static let windowCardMinHeight: CGFloat = 120
    static let hintColumnWidth: CGFloat = 640
    static let fieldMaxWidth: CGFloat = 1100
    static let readingMaxWidth: CGFloat = 1240
    /// Dist Apple TV icon is 400×240; this height keeps the ZB mark readable
    /// at 10 feet without crowding the wizard cards.
    static let brandIconHeight: CGFloat = 76

    // Type. Body copy stays at or above the 29pt tvOS floor.
    static let heroFont = Font.system(size: 62, weight: .bold)
    static let titleFont = Font.system(size: 44, weight: .bold)
    static let sectionTitleFont = Font.system(size: 38, weight: .semibold)
    static let cardTitleFont = Font.system(size: 36, weight: .semibold)
    static let bodyFont = Font.system(size: 32)
    static let captionFont = Font.system(size: 29)
    static let eyebrowFont = Font.system(size: 26, weight: .semibold)
    static let buttonFont = Font.system(size: 32, weight: .semibold)
    static let chipFont = Font.system(size: 28, weight: .semibold)
    static let scoreFont = Font.system(size: 29, weight: .semibold)
    static let badgeFont = Font.system(size: 28, weight: .bold)

    // Focus. One language across the target: the focused control darkens or
    // rings, never lightens into the page, and lifts. Gold always means focus —
    // a green ring cannot be told apart from the green border a *selected*
    // card already carries, and every discover result arrives pre-selected.
    static let focusScale: CGFloat = 1.05
    static let focusRing: CGFloat = 8
    static let focusAnimation = Animation.easeOut(duration: 0.16)
}

extension View {
    /// Full-width focus section for one row of the page.
    ///
    /// tvOS moves focus geometrically: a swipe only lands on a focusable view
    /// that sits in the corridor directly in the direction of travel, and the
    /// move is dropped when nothing is there — which reads as a frozen screen.
    /// A row-wide section frame accepts that move instead and hands focus to
    /// its nearest focusable child, so a trailing button and the
    /// leading-aligned cards below it can still reach each other. Sections only
    /// catch moves that cross them, so every row needs its own.
    func tvFocusRow() -> some View {
        frame(maxWidth: .infinity, alignment: .leading)
            .focusSection()
    }
}

/// Static (non-focusable) card surface.
struct TVCardSurface<Content: View>: View {
    var selected: Bool = false
    var focused: Bool = false
    var minHeight: CGFloat? = nil
    var scaleOnFocus: Bool = true
    @ViewBuilder var content: () -> Content

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: TVTheme.cardRadius, style: .continuous)
    }

    private var borderColor: Color {
        if focused { return ZenBuyTheme.insightGold }
        return selected ? ZenBuyTheme.green : ZenBuyTheme.border
    }

    private var borderWidth: CGFloat {
        if focused { return TVTheme.focusRing }
        return selected ? 4 : 2
    }

    var body: some View {
        content()
            .padding(TVTheme.cardPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(minHeight: minHeight, alignment: .topLeading)
            .background(selected ? ZenBuyTheme.greenLight : ZenBuyTheme.card)
            .clipShape(shape)
            .overlay(shape.strokeBorder(borderColor, lineWidth: borderWidth))
            .shadow(
                color: Color.black.opacity(focused ? 0.3 : 0.08),
                radius: focused ? 26 : 10,
                y: focused ? 14 : 5
            )
            .scaleEffect(focused && scaleOnFocus ? TVTheme.focusScale : 1)
            .animation(TVTheme.focusAnimation, value: focused)
    }
}

/// Read-only card that still takes focus. tvOS only moves focus to interactive
/// views, and a `ScrollView` whose content is all text does not scroll with the
/// Siri Remote at all — so long reports need focusable cards.
struct TVFocusableCard<Content: View>: View {
    @FocusState private var isFocused: Bool
    @ViewBuilder var content: () -> Content

    var body: some View {
        TVCardSurface(focused: isFocused, scaleOnFocus: false) {
            content()
        }
        .focusable()
        .focused($isFocused)
    }
}

/// Selectable wizard card. Keeps a light fill in every state so the title and
/// body text are always dark-on-light — the system `.card` style plus a green
/// `tint` produced light-on-light labels on the focused card.
struct TVCardButtonStyle: ButtonStyle {
    var selected: Bool = false
    var minHeight: CGFloat? = nil

    func makeBody(configuration: Configuration) -> some View {
        Surface(configuration: configuration, selected: selected, minHeight: minHeight)
    }

    private struct Surface: View {
        let configuration: ButtonStyleConfiguration
        let selected: Bool
        let minHeight: CGFloat?
        @Environment(\.isFocused) private var isFocused

        var body: some View {
            TVCardSurface(selected: selected, focused: isFocused, minHeight: minHeight) {
                configuration.label
            }
            .opacity(configuration.isPressed ? 0.9 : 1)
        }
    }
}

/// Capsule controls. `.bordered` / `.borderedProminent` with a green `tint`
/// rendered a green label on a green fill on tvOS — empty-looking pills —
/// so fill and label are set explicitly per focus state.
struct TVActionButtonStyle: ButtonStyle {
    enum Kind {
        case primary
        case secondary
        case chip
    }

    var kind: Kind = .primary

    func makeBody(configuration: Configuration) -> some View {
        Surface(configuration: configuration, kind: kind)
    }

    private struct Surface: View {
        let configuration: ButtonStyleConfiguration
        let kind: Kind
        @Environment(\.isFocused) private var isFocused
        @Environment(\.isEnabled) private var isEnabled

        private var fill: Color {
            guard isEnabled else { return ZenBuyTheme.surface }
            if isFocused { return ZenBuyTheme.greenDark }
            return kind == .primary ? ZenBuyTheme.green : ZenBuyTheme.card
        }

        private var label: Color {
            guard isEnabled else { return ZenBuyTheme.muted }
            if isFocused { return .white }
            return kind == .primary ? .white : ZenBuyTheme.greenDark
        }

        private var ringColor: Color {
            guard isEnabled else { return ZenBuyTheme.border }
            if isFocused { return ZenBuyTheme.insightGold }
            return kind == .primary ? .clear : ZenBuyTheme.green
        }

        private var ringWidth: CGFloat {
            if isFocused { return 6 }
            return kind == .primary ? 0 : 3
        }

        private var horizontalPadding: CGFloat { kind == .chip ? 28 : 38 }
        private var verticalPadding: CGFloat { kind == .chip ? 16 : 20 }

        var body: some View {
            configuration.label
                .font(kind == .chip ? TVTheme.chipFont : TVTheme.buttonFont)
                .foregroundStyle(label)
                .tint(label)
                .lineLimit(1)
                .padding(.horizontal, horizontalPadding)
                .padding(.vertical, verticalPadding)
                .background(fill, in: Capsule())
                .overlay(Capsule().strokeBorder(ringColor, lineWidth: ringWidth))
                .shadow(
                    color: Color.black.opacity(isFocused ? 0.3 : 0),
                    radius: isFocused ? 20 : 0,
                    y: isFocused ? 10 : 0
                )
                .scaleEffect(isFocused ? TVTheme.focusScale : 1)
                .animation(TVTheme.focusAnimation, value: isFocused)
                .opacity(configuration.isPressed ? 0.9 : 1)
        }
    }
}

extension ButtonStyle where Self == TVActionButtonStyle {
    static var tvPrimary: TVActionButtonStyle { TVActionButtonStyle(kind: .primary) }
    static var tvSecondary: TVActionButtonStyle { TVActionButtonStyle(kind: .secondary) }
    static var tvChip: TVActionButtonStyle { TVActionButtonStyle(kind: .chip) }
}

extension ButtonStyle where Self == TVCardButtonStyle {
    static func tvCard(selected: Bool = false, minHeight: CGFloat? = nil) -> TVCardButtonStyle {
        TVCardButtonStyle(selected: selected, minHeight: minHeight)
    }
}

/// Top-left lockup for TV chrome. Uses the Dist Apple TV icon art (ZB +
/// candles), not the older in-app lens mark. Not focusable — it is chrome.
struct TVBrandHeader: View {
    var onDark: Bool = true

    var body: some View {
        HStack(alignment: .center, spacing: 20) {
            Image("BrandIcon")
                .resizable()
                .scaledToFit()
                .frame(height: TVTheme.brandIconHeight)
                .accessibilityHidden(true)
            Text("ZenBuy")
                .font(TVTheme.cardTitleFont)
                .foregroundStyle(onDark ? Color.white : ZenBuyTheme.ink)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("ZenBuy")
    }
}
