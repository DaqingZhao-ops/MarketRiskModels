import AppKit
import Foundation
import WebKit

struct LauncherConfig: Decodable {
    let projectRoot: String
    let nodeBin: String
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var statusLabel: NSTextField!
    private var webProcess: Process?
    private var pythonProcess: Process?
    private var logHandle: FileHandle?

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildWindow()
        do {
            let config = try loadConfig()
            try startServices(config)
            waitForWebServer(attempt: 0)
        } catch {
            showFailure(error.localizedDescription)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        stop(process: webProcess)
        stop(process: pythonProcess)
        try? logHandle?.close()
    }

    private func buildWindow() {
        let frame = NSRect(x: 0, y: 0, width: 1440, height: 920)
        window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Market Risk Models"
        window.titlebarAppearsTransparent = true
        window.center()

        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: frame, configuration: configuration)
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]

        statusLabel = NSTextField(labelWithString: "Starting local risk services…")
        statusLabel.font = .systemFont(ofSize: 18, weight: .medium)
        statusLabel.textColor = NSColor(calibratedRed: 0.13, green: 0.30, blue: 0.26, alpha: 1)
        statusLabel.alignment = .center
        statusLabel.frame = NSRect(x: 220, y: 430, width: 1000, height: 30)
        statusLabel.autoresizingMask = [.minXMargin, .maxXMargin, .minYMargin, .maxYMargin]

        let container = NSView(frame: frame)
        container.addSubview(webView)
        container.addSubview(statusLabel)
        webView.isHidden = true
        window.contentView = container
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func loadConfig() throws -> LauncherConfig {
        guard let url = Bundle.main.url(forResource: "launcher-config", withExtension: "json") else {
            throw NSError(domain: "MarketRiskModels", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "The desktop launcher configuration is missing."
            ])
        }
        return try JSONDecoder().decode(LauncherConfig.self, from: Data(contentsOf: url))
    }

    private func startServices(_ config: LauncherConfig) throws {
        let project = URL(fileURLWithPath: config.projectRoot, isDirectory: true)
        guard FileManager.default.fileExists(atPath: project.appendingPathComponent("package.json").path) else {
            throw NSError(domain: "MarketRiskModels", code: 2, userInfo: [
                NSLocalizedDescriptionKey:
                    "The project folder was not found at \(config.projectRoot). Rebuild the Mac app after moving the project."
            ])
        }

        let support = try applicationSupportDirectory()
        let logURL = support.appendingPathComponent("desktop.log")
        if !FileManager.default.fileExists(atPath: logURL.path) {
            FileManager.default.createFile(atPath: logURL.path, contents: nil)
        }
        logHandle = try FileHandle(forWritingTo: logURL)
        try logHandle?.seekToEnd()

        let backend = project.appendingPathComponent("backend", isDirectory: true)
        let uvicorn = backend.appendingPathComponent(".venv/bin/uvicorn").path
        guard FileManager.default.isExecutableFile(atPath: uvicorn) else {
            throw NSError(domain: "MarketRiskModels", code: 3, userInfo: [
                NSLocalizedDescriptionKey:
                    "The Python environment is missing. Run the backend setup from README.md, then rebuild the app."
            ])
        }

        pythonProcess = Process()
        pythonProcess?.executableURL = URL(fileURLWithPath: uvicorn)
        pythonProcess?.arguments = [
            "market_risk.api:app", "--host", "127.0.0.1", "--port", "8000"
        ]
        pythonProcess?.currentDirectoryURL = backend
        var pythonEnvironment = ProcessInfo.processInfo.environment
        pythonEnvironment["MARKET_RISK_DATABASE_URL"] =
            "sqlite:///\(support.appendingPathComponent("market_risk.db").path)"
        pythonEnvironment["MARKET_RISK_ALLOWED_ORIGINS"] = "http://127.0.0.1:3000,http://localhost:3000"
        pythonProcess?.environment = pythonEnvironment
        pythonProcess?.standardOutput = logHandle
        pythonProcess?.standardError = logHandle
        try pythonProcess?.run()

        let npm = URL(fileURLWithPath: config.nodeBin).appendingPathComponent("npm").path
        guard FileManager.default.isExecutableFile(atPath: npm) else {
            throw NSError(domain: "MarketRiskModels", code: 4, userInfo: [
                NSLocalizedDescriptionKey: "Node.js was not found at \(config.nodeBin). Rebuild the app with Node.js installed."
            ])
        }
        webProcess = Process()
        webProcess?.executableURL = URL(fileURLWithPath: npm)
        webProcess?.arguments = ["run", "start"]
        webProcess?.currentDirectoryURL = project
        var webEnvironment = ProcessInfo.processInfo.environment
        webEnvironment["PATH"] = "\(config.nodeBin):\(webEnvironment["PATH"] ?? "/usr/bin:/bin")"
        webEnvironment["HOST"] = "127.0.0.1"
        webEnvironment["PYTHON_RISK_API_URL"] = "http://127.0.0.1:8000"
        webProcess?.environment = webEnvironment
        webProcess?.standardOutput = logHandle
        webProcess?.standardError = logHandle
        try webProcess?.run()
    }

    private func applicationSupportDirectory() throws -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = base.appendingPathComponent("MarketRiskModels", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func waitForWebServer(attempt: Int) {
        guard attempt < 120 else {
            showFailure("The local web server did not start. See ~/Library/Application Support/MarketRiskModels/desktop.log.")
            return
        }
        var request = URLRequest(url: URL(string: "http://127.0.0.1:3000")!)
        request.timeoutInterval = 1
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async {
                if (response as? HTTPURLResponse)?.statusCode == 200 {
                    self?.statusLabel.isHidden = true
                    self?.webView.isHidden = false
                    self?.webView.load(URLRequest(url: URL(string: "http://127.0.0.1:3000")!))
                } else {
                    self?.statusLabel.stringValue = "Starting local services… \(attempt / 2)s"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                        self?.waitForWebServer(attempt: attempt + 1)
                    }
                }
            }
        }.resume()
    }

    private func showFailure(_ message: String) {
        statusLabel.stringValue = message
        statusLabel.textColor = .systemRed
        statusLabel.frame = NSRect(x: 120, y: 390, width: 1200, height: 100)
        statusLabel.maximumNumberOfLines = 4
    }

    private func stop(process: Process?) {
        guard let process, process.isRunning else { return }
        process.terminate()
        DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
            if process.isRunning {
                kill(process.processIdentifier, SIGKILL)
            }
        }
    }
}

@main
struct MarketRiskModelsApplication {
    static func main() {
        let application = NSApplication.shared
        let delegate = AppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }
}
