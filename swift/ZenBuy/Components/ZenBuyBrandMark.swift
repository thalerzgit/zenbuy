import SwiftUI

/// Foresight lens — squircle frame, candlestick chart, gold insight ray.
struct ZenBuyBrandMark: View {
    var size: CGFloat = 40
    var onDark: Bool = false

    private var frame: Color { onDark ? Color.white.opacity(0.92) : ZenBuyTheme.green }
    private var fill: Color { onDark ? Color.white.opacity(0.1) : Color(red: 0.96, green: 0.98, blue: 0.95) }
    private var chart: Color { onDark ? .white : ZenBuyTheme.green }
    private var insight: Color { ZenBuyTheme.insightGold }
    private var insightBright: Color { Color(red: 0.91, green: 0.77, blue: 0.28) }

    var body: some View {
        Canvas { context, canvasSize in
            let s = min(canvasSize.width, canvasSize.height)
            let scale = s / 48

            func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: x * scale, y: y * scale)
            }

            func rect(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat) -> CGRect {
                CGRect(x: x * scale, y: y * scale, width: w * scale, height: h * scale)
            }

            let squircle = Path(roundedRect: rect(3, 3, 42, 42), cornerRadius: 11 * scale)
            context.fill(squircle, with: .color(fill))
            context.stroke(squircle, with: .color(frame), lineWidth: 2 * scale)

            var baseline = Path()
            baseline.move(to: pt(11, 34))
            baseline.addLine(to: pt(37, 34))
            context.stroke(
                baseline,
                with: .color(onDark ? Color.white.opacity(0.28) : ZenBuyTheme.border),
                style: StrokeStyle(lineWidth: 1.2 * scale, lineCap: .round)
            )

            let candles: [(CGFloat, CGFloat, CGFloat, CGFloat, Double)] = [
                (14, 25, 9, 23, 0.62),
                (23, 21, 10, 19, 0.82),
                (32, 16, 12, 14, 1.0),
            ]

            for (cx, bodyY, bodyH, wickTop, opacity) in candles {
                var wick = Path()
                wick.move(to: pt(cx, 34))
                wick.addLine(to: pt(cx, wickTop))
                context.stroke(wick, with: .color(chart.opacity(opacity)), lineWidth: 1.3 * scale)

                let body = Path(roundedRect: rect(cx - 2.5, bodyY, 5, bodyH), cornerRadius: 1.2 * scale)
                context.fill(body, with: .color(chart.opacity(opacity)))
            }

            var trend = Path()
            trend.move(to: pt(14, 29.5))
            trend.addQuadCurve(to: pt(32, 18.5), control: pt(23.5, 24))
            context.stroke(
                trend,
                with: .color(chart.opacity(onDark ? 0.4 : 0.45)),
                style: StrokeStyle(lineWidth: 1.6 * scale, lineCap: .round)
            )

            let glow = rect(35.5 - 8, 15.5 - 8, 16, 16)
            context.fill(Path(ellipseIn: glow), with: .color(insightBright.opacity(onDark ? 0.35 : 0.25)))

            let core = rect(35.5 - 3.4, 15.5 - 3.4, 6.8, 6.8)
            context.fill(Path(ellipseIn: core), with: .color(onDark ? insightBright : insight))

            let pupil = rect(35.5 - 1.3, 15.5 - 1.3, 2.6, 2.6)
            context.fill(Path(ellipseIn: pupil), with: .color(Color(red: 1, green: 0.97, blue: 0.9)))

            let rays: [(CGFloat, CGFloat)] = [(39.5, 11.5), (41, 15.5), (39.5, 19.5)]
            for (x, y) in rays {
                var ray = Path()
                ray.move(to: pt(35.5, 15.5))
                ray.addLine(to: pt(x, y))
                context.stroke(
                    ray,
                    with: .color(insightBright.opacity(onDark ? 0.75 : 0.55)),
                    style: StrokeStyle(lineWidth: 1.15 * scale, lineCap: .round)
                )
            }
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
                ZenBuyBrandMark(size: compact ? 32 : 44, onDark: onDark)
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
