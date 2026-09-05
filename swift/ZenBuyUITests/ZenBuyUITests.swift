import XCTest

final class ZenBuyUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testLaunchShowsGoalQuestion() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.staticTexts["What's your goal?"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Find stocks"].exists)
        XCTAssertTrue(app.buttons["Analyze stocks you have in mind"].exists)
    }

    func testAnalyzePathReachesTickerField() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["Analyze stocks you have in mind"].waitForExistence(timeout: 5))
        app.buttons["Analyze stocks you have in mind"].tap()
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["What's your investment goal?"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["What's your intended profit window?"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.textFields["AAPL, Apple, Palo Alto…"].waitForExistence(timeout: 5))
    }

    func testFindPathReachesDiscover() throws {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.buttons["Find stocks"].waitForExistence(timeout: 5))
        app.buttons["Find stocks"].tap()
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["What's your investment goal?"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["What's your intended profit window?"].waitForExistence(timeout: 5))
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.buttons["Find stocks for my goal"].waitForExistence(timeout: 8))
    }
}
