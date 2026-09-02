import SwiftUI

/// Web-parity processing panel: phase, ETA, 0–100% bar, rotating investor quotes.
struct ProcessingPanelView: View {
    let progress: ProcessingProgress

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                ProgressView()
                    .tint(ZenBuyTheme.sage)
                VStack(alignment: .leading, spacing: 4) {
                    Text(progress.phase.copy)
                        .font(.body.weight(.semibold))
                        .foregroundStyle(ZenBuyTheme.ink)
                    Text(progress.eta)
                        .font(.subheadline)
                        .foregroundStyle(ZenBuyTheme.muted)
                        .monospacedDigit()
                }
            }

            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(ZenBuyTheme.sageLight)
                    Capsule()
                        .fill(
                            LinearGradient(
                                colors: [ZenBuyTheme.sageDark, ZenBuyTheme.sage],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .frame(width: max(6, geo.size.width * min(1, progress.percent / 100)))
                }
            }
            .frame(height: 10)
            .animation(.linear(duration: 0.35), value: progress.percent)
            .accessibilityValue("\(Int(progress.percent.rounded())) percent")

            if let quote = progress.quote {
                VStack(alignment: .leading, spacing: 6) {
                    Text("“\(quote.text)”")
                        .font(.subheadline.italic())
                        .foregroundStyle(ZenBuyTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("— \(quote.author)")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(ZenBuyTheme.sageDark)
                }
                .id(quote.text)
                .transition(.opacity)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            LinearGradient(
                colors: [ZenBuyTheme.sageLight.opacity(0.7), ZenBuyTheme.card],
                startPoint: .topLeading,
                endPoint: .bottom
            )
        )
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(ZenBuyTheme.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(progress.phase.copy), \(Int(progress.percent.rounded())) percent, \(progress.eta)")
    }
}
