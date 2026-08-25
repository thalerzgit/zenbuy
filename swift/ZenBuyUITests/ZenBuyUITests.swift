import XCTest

final class ZenBuyUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLaunchShowsSearchField() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.textFields["AAPL, Apple, Palo Alto…"].waitForExistence(timeout: 5))
    }
}
