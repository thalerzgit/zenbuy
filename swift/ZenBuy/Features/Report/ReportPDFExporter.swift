import Foundation
#if canImport(UIKit)
import UIKit

/// Builds a local PDF from the native report model (not a webview screenshot).
enum ReportPDFExporter {
    private static let pageWidth: CGFloat = 612
    private static let pageHeight: CGFloat = 792
    private static let inset: CGFloat = 48
    private static var contentWidth: CGFloat { pageWidth - inset * 2 }

    static func makePDF(
        title: String,
        badges: ReportBadges?,
        scorecardHTML: String,
        bottomLineHTML: String,
        bodyHTML: String
    ) -> URL? {
        let hasScorecard = !scorecardHTML.isEmpty
        let scoreNodes = ReportHTML.parse(scorecardHTML)
        let bottom = ReportHTML.parseProgressive(bottomLineHTML, hasScorecard: hasScorecard)
        let body = ReportHTML.parseProgressive(bodyHTML, hasScorecard: hasScorecard)
        let bottomSections = ReportHTML.sections(from: bottom.nodes, hasScorecard: hasScorecard)
        let bodySections = ReportHTML.sections(from: body.nodes, hasScorecard: hasScorecard)

        let page = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
        let renderer = UIGraphicsPDFRenderer(bounds: page)

        let data = renderer.pdfData { context in
            var y = inset

            func newPage() {
                context.beginPage()
                y = inset
            }

            func ensureSpace(_ needed: CGFloat) {
                if y + needed > pageHeight - inset {
                    newPage()
                }
            }

            func draw(_ string: String, font: UIFont, color: UIColor, width: CGFloat = ReportPDFExporter.contentWidth) {
                let attrs: [NSAttributedString.Key: Any] = [
                    .font: font,
                    .foregroundColor: color,
                ]
                let height = (string as NSString).boundingRect(
                    with: CGSize(width: width, height: .greatestFiniteMagnitude),
                    options: [.usesLineFragmentOrigin, .usesFontLeading],
                    attributes: attrs,
                    context: nil
                ).height.rounded(.up)
                ensureSpace(height + 4)
                (string as NSString).draw(
                    in: CGRect(x: inset, y: y, width: width, height: height),
                    withAttributes: attrs
                )
                y += height + 8
            }

            newPage()

            draw(title, font: .boldSystemFont(ofSize: 20), color: .black)
            draw("ZenBuy research report", font: .systemFont(ofSize: 11), color: .darkGray)

            var badgeBits: [String] = []
            if let r = badges?.recommendation, !r.isEmpty { badgeBits.append(r) }
            if let s = badges?.sentiment, !s.isEmpty { badgeBits.append(s) }
            if let c = badges?.conviction, !c.isEmpty { badgeBits.append(c) }
            if !badgeBits.isEmpty {
                draw(
                    badgeBits.joined(separator: " · "),
                    font: .boldSystemFont(ofSize: 12),
                    color: UIColor(red: 0.20, green: 0.43, blue: 0.15, alpha: 1)
                )
            }

            for node in scoreNodes {
                if case let .scorecard(rows) = node {
                    draw(
                        "Scorecard",
                        font: .boldSystemFont(ofSize: 14),
                        color: UIColor(red: 0.20, green: 0.43, blue: 0.15, alpha: 1)
                    )
                    for row in rows {
                        let filled = max(1, Int((row.fraction * 10).rounded()))
                        let bar = String(repeating: "█", count: filled)
                            + String(repeating: "░", count: max(0, 10 - filled))
                        draw("\(row.label)  \(bar)  \(row.value)", font: .systemFont(ofSize: 11), color: .black)
                    }
                }
            }

            for section in bottomSections + bodySections {
                if let sectionTitle = section.title {
                    ensureSpace(28)
                    draw(
                        sectionTitle,
                        font: .boldSystemFont(ofSize: 14),
                        color: UIColor(red: 0.20, green: 0.43, blue: 0.15, alpha: 1)
                    )
                }
                for node in section.nodes {
                    drawNode(node, draw: draw, ensureSpace: ensureSpace)
                }
                if !section.sources.isEmpty {
                    let labels = section.sources.map(\.label).joined(separator: " · ")
                    draw("Sources: \(labels)", font: .italicSystemFont(ofSize: 10), color: .darkGray)
                }
            }
        }

        let safeTitle = title
            .replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: " ", with: "-")
        let filename = "ZenBuy-\(safeTitle)-report.pdf"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(filename)
        do {
            try data.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    private static func drawNode(
        _ node: ReportHTMLNode,
        draw: (String, UIFont, UIColor, CGFloat) -> Void,
        ensureSpace: (CGFloat) -> Void
    ) {
        switch node {
        case let .heading(_, text):
            draw(text, .boldSystemFont(ofSize: 13), .black, contentWidth)
        case let .paragraph(inlines):
            draw(plain(inlines), .systemFont(ofSize: 11), .black, contentWidth)
        case let .list(items):
            for item in items {
                draw("• " + plain(item), .systemFont(ofSize: 11), .black, contentWidth)
            }
        case let .table(headers, rows):
            if !headers.isEmpty {
                draw(headers.joined(separator: " | "), .boldSystemFont(ofSize: 10), .darkGray, contentWidth)
            }
            for row in rows {
                draw(row.joined(separator: " | "), .systemFont(ofSize: 10), .black, contentWidth)
            }
        case let .scorecard(rows):
            for row in rows {
                draw("\(row.label): \(row.value)", .systemFont(ofSize: 11), .black, contentWidth)
            }
        case .spacer:
            ensureSpace(8)
        }
    }

    private static func plain(_ inlines: [ReportInline]) -> String {
        inlines.map { inline in
            switch inline {
            case let .text(s), let .strong(s): return s
            case let .link(label, _): return label
            }
        }.joined()
    }
}
#endif
