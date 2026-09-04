import Foundation
#if canImport(UIKit)
import UIKit

private typealias Palette = ZenBuyTheme.UIKitPalette

/// Builds a local PDF from the native report model (not a webview screenshot).
/// Styling mirrors the ZenBuy website print: mint recommendation pills, filled
/// score bars, dark-green section titles and mint table headers.
enum ReportPDFExporter {
    private static let pageWidth: CGFloat = 612
    private static let pageHeight: CGFloat = 792
    private static let inset: CGFloat = 48

    static func makePDF(
        title: String,
        badges: ReportBadges?,
        scorecardHTML: String,
        bottomLineHTML: String,
        bodyHTML: String
    ) -> URL? {
        let hasScorecard = !scorecardHTML.isEmpty
        let scoreRows = parseScoreRows(from: scorecardHTML)
        let bottom = ReportHTML.parseProgressive(bottomLineHTML, hasScorecard: hasScorecard)
        let body = ReportHTML.parseProgressive(bodyHTML, hasScorecard: hasScorecard)
        let bottomSections = ReportHTML.sections(from: bottom.nodes, hasScorecard: hasScorecard)
        let bodySections = ReportHTML.sections(from: body.nodes, hasScorecard: hasScorecard)
        let pills = badgePills(badges)

        let bounds = CGRect(x: 0, y: 0, width: pageWidth, height: pageHeight)
        let format = UIGraphicsPDFRendererFormat()
        format.documentInfo = [
            kCGPDFContextTitle as String: "ZenBuy — \(title)",
            kCGPDFContextCreator as String: "ZenBuy",
        ]
        let renderer = UIGraphicsPDFRenderer(bounds: bounds, format: format)

        // First pass only counts pages so the footer can read "Page 1 of N".
        let probe = renderer.pdfData { context in
            render(
                context: context,
                bounds: bounds,
                totalPages: nil,
                title: title,
                pills: pills,
                scoreRows: scoreRows,
                bottomSections: bottomSections,
                bodySections: bodySections
            )
        }
        let totalPages = pageCount(of: probe)
        let data = renderer.pdfData { context in
            render(
                context: context,
                bounds: bounds,
                totalPages: totalPages,
                title: title,
                pills: pills,
                scoreRows: scoreRows,
                bottomSections: bottomSections,
                bodySections: bodySections
            )
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

    // MARK: - Page composition

    private static func render(
        context: UIGraphicsPDFRendererContext,
        bounds: CGRect,
        totalPages: Int?,
        title: String,
        pills: [ReportPDFPill],
        scoreRows: [ReportHTMLNode.ScoreRow],
        bottomSections: [ReportSection],
        bodySections: [ReportSection]
    ) {
        let canvas = ReportPDFCanvas(
            context: context,
            bounds: bounds,
            inset: inset,
            totalPages: totalPages
        )
        canvas.beginPage()

        canvas.drawText(
            ReportPDFText.make(
                title,
                font: .systemFont(ofSize: 26, weight: .bold),
                color: Palette.ink,
                kern: -0.4
            ),
            spacingAfter: 2
        )
        canvas.drawText(
            ReportPDFText.make(
                "ZenBuy research report",
                font: .systemFont(ofSize: 10.5),
                color: Palette.muted
            ),
            spacingAfter: 12
        )

        if !pills.isEmpty {
            canvas.drawPills(pills, spacingAfter: 18)
        }

        // Scorecard floats to the right of BOTTOM LINE, like the web print.
        if !scoreRows.isEmpty {
            let cardWidth: CGFloat = 208
            let gutter: CGFloat = 20
            canvas.ensure(72)
            let cardHeight = canvas.drawScoreCard(
                rows: scoreRows,
                x: canvas.contentLeft + canvas.fullWidth - cardWidth,
                top: canvas.y,
                width: cardWidth
            )
            canvas.setFloat(
                bottom: canvas.y + cardHeight + 14,
                width: canvas.fullWidth - cardWidth - gutter
            )
        }

        drawSections(bottomSections, canvas: canvas)
        canvas.clearFloat()
        drawSections(bodySections, canvas: canvas)
    }

    private static func drawSections(_ sections: [ReportSection], canvas: ReportPDFCanvas) {
        for section in sections {
            if let title = section.title, !title.isEmpty {
                canvas.ensure(34)
                canvas.drawText(sectionTitle(title), spacingAfter: 9)
            }
            for node in section.nodes {
                drawNode(node, canvas: canvas)
            }
            if !section.sources.isEmpty {
                canvas.drawPills(
                    section.sources.map { source in
                        ReportPDFPill(
                            text: source.label,
                            background: Palette.greenLight,
                            foreground: Palette.greenDark,
                            font: .systemFont(ofSize: 8, weight: .semibold)
                        )
                    },
                    height: 18,
                    spacingAfter: 12
                )
            }
            canvas.space(4)
        }
    }

    private static func drawNode(_ node: ReportHTMLNode, canvas: ReportPDFCanvas) {
        switch node {
        case let .heading(level, text):
            if level <= 2 {
                canvas.ensure(30)
                canvas.drawText(sectionTitle(text), spacingAfter: 9)
            } else {
                canvas.drawText(
                    ReportPDFText.make(
                        text,
                        font: .systemFont(ofSize: 11.5, weight: .semibold),
                        color: Palette.ink
                    ),
                    spacingAfter: 6
                )
            }
        case let .paragraph(inlines):
            canvas.drawText(bodyText(inlines), spacingAfter: 9)
        case let .list(items):
            for item in items {
                canvas.drawBullet(bodyText(item), spacingAfter: 7)
            }
            canvas.space(3)
        case let .table(headers, rows):
            canvas.drawTable(headers: headers, rows: rows, spacingAfter: 14)
        case let .scorecard(rows):
            canvas.ensure(60)
            let height = canvas.drawScoreCard(
                rows: rows,
                x: canvas.contentLeft,
                top: canvas.y,
                width: min(canvas.currentWidth, 300)
            )
            canvas.space(height + 14)
        case .spacer:
            canvas.space(6)
        }
    }

    // MARK: - Styling helpers

    private static func sectionTitle(_ text: String) -> NSAttributedString {
        ReportPDFText.make(
            text.uppercased(),
            font: .systemFont(ofSize: 12, weight: .bold),
            color: Palette.greenDark,
            kern: 0.8
        )
    }

    private static func bodyText(_ inlines: [ReportInline]) -> NSAttributedString {
        ReportPDFText.inlines(
            inlines,
            font: .systemFont(ofSize: 10.5),
            color: Palette.ink
        )
    }

    /// Recommendation / sentiment / conviction pills using the same buy-sell-hold
    /// colours as `.badge` in the website stylesheet.
    private static func badgePills(_ badges: ReportBadges?) -> [ReportPDFPill] {
        var pills: [ReportPDFPill] = []
        if let value = badges?.recommendation, !value.isEmpty {
            pills.append(verdictPill(value, text: value))
        }
        if let value = badges?.sentiment, !value.isEmpty {
            pills.append(verdictPill(value, text: value))
        }
        if let value = badges?.conviction, !value.isEmpty {
            let label = value.lowercased().contains("conviction") ? value : "\(value) conviction"
            pills.append(
                ReportPDFPill(
                    text: label,
                    background: Palette.greenLight,
                    foreground: Palette.greenDark
                )
            )
        }
        return pills
    }

    private static func verdictPill(_ value: String, text: String) -> ReportPDFPill {
        let lower = value.lowercased()
        if lower.contains("sell") || lower.contains("bear") {
            return ReportPDFPill(text: text, background: Palette.badgeSell, foreground: Palette.bear)
        }
        if lower.contains("hold") || lower.contains("neutral") {
            return ReportPDFPill(text: text, background: Palette.badgeHold, foreground: Palette.neutral)
        }
        if lower.contains("buy") || lower.contains("bull") {
            return ReportPDFPill(
                text: text,
                background: Palette.badgeBuy,
                foreground: Palette.greenPositive
            )
        }
        return ReportPDFPill(text: text, background: Palette.greenLight, foreground: Palette.greenDark)
    }

    private static func parseScoreRows(from html: String) -> [ReportHTMLNode.ScoreRow] {
        for node in ReportHTML.parse(html) {
            if case let .scorecard(rows) = node {
                return rows
            }
        }
        return []
    }

    private static func pageCount(of data: Data) -> Int? {
        guard let provider = CGDataProvider(data: data as CFData),
              let document = CGPDFDocument(provider) else { return nil }
        return document.numberOfPages > 0 ? document.numberOfPages : nil
    }
}

// MARK: - Text

private enum ReportPDFText {
    static func make(
        _ string: String,
        font: UIFont,
        color: UIColor,
        kern: CGFloat = 0,
        lineSpacing: CGFloat = 2.5,
        alignment: NSTextAlignment = .natural
    ) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = lineSpacing
        paragraph.alignment = alignment
        var attributes: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: color,
            .paragraphStyle: paragraph,
        ]
        if kern != 0 {
            attributes[.kern] = kern
        }
        return NSAttributedString(string: string, attributes: attributes)
    }

    /// Keeps bold runs bold and paints citation links in brand green.
    static func inlines(_ inlines: [ReportInline], font: UIFont, color: UIColor) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineSpacing = 2.5
        let bold = UIFont.systemFont(ofSize: font.pointSize, weight: .semibold)
        let result = NSMutableAttributedString()
        for inline in inlines {
            switch inline {
            case let .text(string):
                result.append(
                    NSAttributedString(
                        string: string,
                        attributes: [
                            .font: font,
                            .foregroundColor: color,
                            .paragraphStyle: paragraph,
                        ]
                    )
                )
            case let .strong(string):
                result.append(
                    NSAttributedString(
                        string: string,
                        attributes: [
                            .font: bold,
                            .foregroundColor: color,
                            .paragraphStyle: paragraph,
                        ]
                    )
                )
            case let .link(label, _):
                result.append(
                    NSAttributedString(
                        string: label,
                        attributes: [
                            .font: bold,
                            .foregroundColor: Palette.green,
                            .underlineStyle: NSUnderlineStyle.single.rawValue,
                            .paragraphStyle: paragraph,
                        ]
                    )
                )
            }
        }
        return result
    }
}

private struct ReportPDFPill {
    let text: String
    let background: UIColor
    let foreground: UIColor
    var font: UIFont = .systemFont(ofSize: 10, weight: .semibold)
}

// MARK: - Canvas

/// Cursor-based drawing over a `UIGraphicsPDFRendererContext`: keeps the running
/// `y`, page breaks, the right-hand scorecard float and the page footer.
private final class ReportPDFCanvas {
    private let context: UIGraphicsPDFRendererContext
    private let bounds: CGRect
    private let inset: CGFloat
    private let totalPages: Int?

    private var pageIndex = 0
    private var floatBottom: CGFloat = 0
    private var floatWidth: CGFloat = 0

    var y: CGFloat = 0

    init(
        context: UIGraphicsPDFRendererContext,
        bounds: CGRect,
        inset: CGFloat,
        totalPages: Int?
    ) {
        self.context = context
        self.bounds = bounds
        self.inset = inset
        self.totalPages = totalPages
    }

    var contentLeft: CGFloat { inset }
    var fullWidth: CGFloat { bounds.width - inset * 2 }
    var contentBottom: CGFloat { bounds.height - inset - 24 }
    /// Narrower while content flows beside the floated scorecard.
    var currentWidth: CGFloat { y < floatBottom ? floatWidth : fullWidth }

    func beginPage() {
        context.beginPage()
        pageIndex += 1
        y = inset
        floatBottom = 0
        floatWidth = 0
        drawFooter()
    }

    func ensure(_ height: CGFloat) {
        if pageIndex == 0 {
            beginPage()
            return
        }
        if y + height > contentBottom {
            beginPage()
        }
    }

    func space(_ height: CGFloat) {
        y += height
    }

    func setFloat(bottom: CGFloat, width: CGFloat) {
        floatBottom = bottom
        floatWidth = max(width, 160)
    }

    func clearFloat() {
        if floatBottom > y {
            y = floatBottom
        }
        floatBottom = 0
        floatWidth = 0
    }

    // MARK: Text

    func drawText(_ text: NSAttributedString, spacingAfter: CGFloat) {
        var width = currentWidth
        var height = ReportPDFCanvas.measure(text, width: width)
        ensure(height)
        if currentWidth != width {
            width = currentWidth
            height = ReportPDFCanvas.measure(text, width: width)
        }
        text.draw(
            with: CGRect(x: inset, y: y, width: width, height: height + 2),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            context: nil
        )
        y += height + spacingAfter
    }

    func drawBullet(_ text: NSAttributedString, spacingAfter: CGFloat) {
        let indent: CGFloat = 14
        var width = currentWidth - indent
        var height = ReportPDFCanvas.measure(text, width: width)
        ensure(height)
        if currentWidth - indent != width {
            width = currentWidth - indent
            height = ReportPDFCanvas.measure(text, width: width)
        }
        let bullet = ReportPDFText.make(
            "•",
            font: .systemFont(ofSize: 11, weight: .bold),
            color: Palette.green
        )
        bullet.draw(at: CGPoint(x: inset + 2, y: y))
        text.draw(
            with: CGRect(x: inset + indent, y: y, width: width, height: height + 2),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            context: nil
        )
        y += height + spacingAfter
    }

    // MARK: Pills

    func drawPills(_ pills: [ReportPDFPill], height: CGFloat = 22, spacingAfter: CGFloat) {
        guard !pills.isEmpty else { return }
        let gap: CGFloat = 8
        ensure(height)
        var x = inset
        for pill in pills {
            let attributes: [NSAttributedString.Key: Any] = [
                .font: pill.font,
                .foregroundColor: pill.foreground,
            ]
            let textSize = (pill.text as NSString).size(withAttributes: attributes)
            let pillWidth = textSize.width + 22
            if x > inset, x + pillWidth > inset + currentWidth {
                y += height + gap
                ensure(height)
                x = inset
            }
            let rect = CGRect(x: x, y: y, width: pillWidth, height: height)
            pill.background.setFill()
            UIBezierPath(roundedRect: rect, cornerRadius: height / 2).fill()
            (pill.text as NSString).draw(
                at: CGPoint(x: x + 11, y: y + (height - textSize.height) / 2),
                withAttributes: attributes
            )
            x += pillWidth + gap
        }
        y += height + spacingAfter
    }

    // MARK: Scorecard

    /// Bordered card with mint tracks and dark-green fills. Does not move `y`.
    @discardableResult
    func drawScoreCard(
        rows: [ReportHTMLNode.ScoreRow],
        x: CGFloat,
        top: CGFloat,
        width: CGFloat
    ) -> CGFloat {
        guard !rows.isEmpty else { return 0 }
        let padding: CGFloat = 14
        let rowHeight: CGFloat = 19
        let height = padding * 2 + CGFloat(rows.count) * rowHeight

        let card = CGRect(x: x, y: top, width: width, height: height)
        let path = UIBezierPath(roundedRect: card, cornerRadius: 10)
        UIColor.white.setFill()
        path.fill()
        Palette.border.setStroke()
        path.lineWidth = 0.8
        path.stroke()

        let labelWidth: CGFloat = 52
        let valueWidth: CGFloat = 34
        let trackHeight: CGFloat = 6
        var rowTop = top + padding

        for row in rows {
            let label = ReportPDFText.make(
                row.label,
                font: .systemFont(ofSize: 8.5, weight: .medium),
                color: Palette.muted,
                lineSpacing: 0
            )
            label.draw(at: CGPoint(x: x + padding, y: rowTop))

            let trackX = x + padding + labelWidth
            let trackWidth = width - padding * 2 - labelWidth - valueWidth - 12
            if trackWidth > 8 {
                let trackRect = CGRect(
                    x: trackX,
                    y: rowTop + 4,
                    width: trackWidth,
                    height: trackHeight
                )
                Palette.greenLight.setFill()
                UIBezierPath(roundedRect: trackRect, cornerRadius: trackHeight / 2).fill()

                let fillWidth = max(trackHeight, trackWidth * CGFloat(row.fraction))
                let fillRect = CGRect(
                    x: trackX,
                    y: rowTop + 4,
                    width: fillWidth,
                    height: trackHeight
                )
                Palette.greenDark.setFill()
                UIBezierPath(roundedRect: fillRect, cornerRadius: trackHeight / 2).fill()
            }

            let value = ReportPDFText.make(
                row.value,
                font: .systemFont(ofSize: 8.5, weight: .semibold),
                color: Palette.greenDark,
                lineSpacing: 0,
                alignment: .right
            )
            value.draw(
                with: CGRect(
                    x: x + width - padding - valueWidth,
                    y: rowTop,
                    width: valueWidth,
                    height: rowHeight
                ),
                options: [.usesLineFragmentOrigin, .usesFontLeading],
                context: nil
            )

            rowTop += rowHeight
        }
        return height
    }

    // MARK: Tables

    func drawTable(headers: [String], rows: [[String]], spacingAfter: CGFloat) {
        let columnCount = max(headers.count, rows.map(\.count).max() ?? 0)
        guard columnCount > 0 else { return }

        let tableWidth = currentWidth
        let headerFont = UIFont.systemFont(ofSize: 8.5, weight: .semibold)
        let cellFont = UIFont.systemFont(ofSize: 8.5)
        let padding: CGFloat = 8

        var natural = [CGFloat](repeating: 44, count: columnCount)
        for (index, header) in headers.enumerated() where index < columnCount {
            let width = (header as NSString).size(withAttributes: [.font: headerFont]).width
            natural[index] = max(natural[index], min(width + padding * 2, 180))
        }
        for row in rows {
            for (index, cell) in row.enumerated() where index < columnCount {
                let width = (cell as NSString).size(withAttributes: [.font: cellFont]).width
                natural[index] = max(natural[index], min(width + padding * 2, 180))
            }
        }
        let naturalTotal = natural.reduce(0, +)
        let scale = naturalTotal > 0 ? tableWidth / naturalTotal : 1
        let widths = natural.map { $0 * scale }

        func rowHeight(_ cells: [String], font: UIFont) -> CGFloat {
            var height: CGFloat = 0
            for (index, cell) in cells.enumerated() where index < columnCount {
                let text = ReportPDFText.make(cell, font: font, color: Palette.ink, lineSpacing: 1.5)
                height = max(
                    height,
                    ReportPDFCanvas.measure(text, width: max(widths[index] - padding * 2, 12))
                )
            }
            return max(height + padding * 1.4, 21)
        }

        func drawRow(_ cells: [String], font: UIFont, color: UIColor, height: CGFloat) {
            var x = self.inset
            for (index, cell) in cells.enumerated() where index < columnCount {
                let text = ReportPDFText.make(cell, font: font, color: color, lineSpacing: 1.5)
                text.draw(
                    with: CGRect(
                        x: x + padding,
                        y: self.y + padding * 0.6,
                        width: max(widths[index] - padding * 2, 12),
                        height: height
                    ),
                    options: [.usesLineFragmentOrigin, .usesFontLeading],
                    context: nil
                )
                x += widths[index]
            }
            self.y += height
        }

        let headerHeight = headers.isEmpty ? 0 : rowHeight(headers, font: headerFont)

        func paintHeader() {
            guard !headers.isEmpty else { return }
            Palette.greenLight.setFill()
            UIBezierPath(
                rect: CGRect(x: self.inset, y: self.y, width: tableWidth, height: headerHeight)
            ).fill()
            drawRow(headers, font: headerFont, color: Palette.greenDark, height: headerHeight)
        }

        ensure(headerHeight + 46)
        var segmentTop = y
        paintHeader()

        for row in rows {
            let height = rowHeight(row, font: cellFont)
            if y + height > contentBottom {
                strokeTableBorder(top: segmentTop, bottom: y, width: tableWidth)
                beginPage()
                segmentTop = y
                paintHeader()
            }
            drawRow(row, font: cellFont, color: Palette.ink, height: height)
            let separator = UIBezierPath()
            separator.move(to: CGPoint(x: inset, y: y))
            separator.addLine(to: CGPoint(x: inset + tableWidth, y: y))
            separator.lineWidth = 0.5
            Palette.border.setStroke()
            separator.stroke()
        }

        strokeTableBorder(top: segmentTop, bottom: y, width: tableWidth)
        y += spacingAfter
    }

    private func strokeTableBorder(top: CGFloat, bottom: CGFloat, width: CGFloat) {
        guard bottom > top else { return }
        let path = UIBezierPath(
            roundedRect: CGRect(x: inset, y: top, width: width, height: bottom - top),
            cornerRadius: 6
        )
        Palette.border.setStroke()
        path.lineWidth = 0.8
        path.stroke()
    }

    // MARK: Footer

    private func drawFooter() {
        let baseline = bounds.height - inset + 4
        ReportPDFText.make(
            "https://zenbuy.info/",
            font: .systemFont(ofSize: 7.5),
            color: Palette.muted,
            lineSpacing: 0
        ).draw(at: CGPoint(x: inset, y: baseline))

        let label = totalPages.map { "Page \(pageIndex) of \($0)" } ?? "Page \(pageIndex)"
        ReportPDFText.make(
            label,
            font: .systemFont(ofSize: 7.5),
            color: Palette.muted,
            lineSpacing: 0,
            alignment: .right
        ).draw(
            with: CGRect(x: inset, y: baseline, width: fullWidth, height: 14),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            context: nil
        )
    }

    static func measure(_ text: NSAttributedString, width: CGFloat) -> CGFloat {
        text.boundingRect(
            with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            context: nil
        ).height.rounded(.up)
    }
}
#endif
