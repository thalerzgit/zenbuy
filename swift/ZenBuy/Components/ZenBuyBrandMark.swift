import SwiftUI

/// Oracle arch + ascending chart — the mark from `public/logo-mark.svg`.
struct ZenBuyBrandMark: View {
    var size: CGFloat = 40
    var onDark: Bool = false

    private var arch: Color { onDark ? .white : ZenBuyTheme.greenDark }
    private var chart: Color { onDark ? Color.white.opacity(0.92) : ZenBuyTheme.green }
    private var insight: Color { ZenBuyTheme.insightGold }

    var body: some View {
        Canvas { context, canvasSize in
            let s = min(canvasSize.width, canvasSize.height)
            let scale = s / 48

            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: x * scale, y: y * scale)
            }

            var archPath = Path()
            archPath.move(to: pt(8, 38))
            archPath.addLine(to: pt(8, 18))
            archPath.addQuadCurve(to: pt(40, 18), control: pt(24, 6))
            archPath.addLine(to: pt(40, 38))
            context.stroke(archPath, with: .color(arch), lineWidth: 2.4 * scale)

            var horizon = Path()
            horizon.move(to: pt(10, 36))
            horizon.addLine(to: pt(38, 36))
            context.stroke(
                horizon,
                with: .color(onDark ? Color.white.opacity(0.25) : ZenBuyTheme.border),
                lineWidth: 1.2 * scale
            )

            var trend = Path()
            trend.move(to: pt(13, 31))
            trend.addLine(to: pt(19, 26))
            trend.addLine(to: pt(25, 22))
            trend.addLine(to: pt(33, 14))
            context.stroke(trend, with: .color(chart), style: StrokeStyle(lineWidth: 2 * scale, lineCap: .round, lineJoin: .round))

            let candles: [(CGFloat, CGFloat, CGFloat, Double)] = [
                (16.5, 24, 6, 0.55), (22.5, 20, 6, 0.75), (28.5, 14, 5, 1),
            ]
            for (x, y, h, opacity) in candles {
                let rect = CGRect(x: x * scale, y: y * scale, width: 3 * scale, height: h * scale)
                context.fill(Path(roundedRect: rect, cornerRadius: 0.8 * scale), with: .color(chart.opacity(opacity)))
            }

            let glow = CGRect(x: (33 - 6) * scale, y: (14 - 6) * scale, width: 12 * scale, height: 12 * scale)
            context.fill(Path(ellipseIn: glow), with: .color(insight.opacity(0.18)))
            let core = CGRect(x: (33 - 2.6) * scale, y: (14 - 2.6) * scale, width: 5.2 * scale, height: 5.2 * scale)
            context.fill(Path(ellipseIn: core), with: .color(insight))
        }
        .frame(width: size, height: size)
        .accessibilityLabel("ZenBuy")
    }
}

struct ZenBuyBrandHeader: View {
    var onDark: Bool = false
    var compact: Bool = false

    var body: some View {
        VStack(spacing: compact ? 2 : 6) {
            HStack(spacing: 10) {
                ZenBuyBrandMark(size: compact ? 32 : 40, onDark: onDark)
                HStack(alignment: .firstTextBaseline, spacing: 0) {
                    Text("ZenBuy")
                        .font(compact ? .headline.weight(.bold) : .title2.weight(.bold))
                        .foregroundStyle(onDark ? .white : ZenBuyTheme.ink)
                    Text(".info")
                        .font(compact ? .headline.weight(.medium) : .title2.weight(.medium))
                        .foregroundStyle(onDark ? ZenBuyTheme.insightGold : ZenBuyTheme.green)
                }
            }
            if !compact {
                Text("The insight you wished you had—earlier.")
                    .font(.subheadline)
                    .foregroundStyle(onDark ? Color.white.opacity(0.88) : ZenBuyTheme.muted)
                    .multilineTextAlignment(.center)
                Text("Know before you trade")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(onDark ? ZenBuyTheme.insightGold.opacity(0.95) : ZenBuyTheme.greenDark)
                    .tracking(0.06)
                    .textCase(.uppercase)
            }
        }
    }
}

#Preview {
    VStack(spacing: 32) {
        ZenBuyBrandHeader()
        ZenBuyBrandHeader(onDark: true)
            .padding()
            .background(ZenBuyTheme.greenDark)
    }
}
