import BookmarkCore
import SwiftRs
import Tauri
import UIKit
import UniformTypeIdentifiers
import WebKit

class PathArgs: Decodable {
  let path: String
}

class WriteArgs: Decodable {
  let path: String
  let data: String
}

/// DevTex vault access on iOS/iPadOS.
class IosBookmarksPlugin: Plugin, UIDocumentPickerDelegate {
  private let vault = VaultBookmarks(storage: UserDefaultsBookmarkStorage(), resolver: SystemBookmarkResolver())
  private var pendingPick: Invoke?

  /// Called when the plugin is registered at app start: restore and start access
  /// to the saved vault BEFORE any filesystem command can run.
  override func load(webview: WKWebView) {
    _ = vault.restore()
  }

  @objc public func restore(_ invoke: Invoke) {
    if let r = vault.restore() {
      invoke.resolve(["path": r.url.path, "refreshed": r.refreshed])
    } else {
      invoke.resolve(["path": NSNull(), "refreshed": false])
    }
  }

  @objc public func pickFolder(_ invoke: Invoke) {
    DispatchQueue.main.async {
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder], asCopy: false)
      picker.allowsMultipleSelection = false
      picker.delegate = self
      self.pendingPick = invoke
      self.manager.viewController?.present(picker, animated: true)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let invoke = pendingPick else { return }
    pendingPick = nil
    guard let url = urls.first else { invoke.resolve(["path": NSNull(), "refreshed": false]); return }
    do {
      let u = try vault.adopt(url)
      invoke.resolve(["path": u.path, "refreshed": false])
    } catch {
      invoke.reject("Could not access the folder: \(error)")
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    pendingPick?.resolve(["path": NSNull(), "refreshed": false])
    pendingPick = nil
  }

  private func checked(_ path: String, _ invoke: Invoke) -> URL? {
    guard vault.contains(path) else {
      invoke.reject("Path is outside the vault folder")
      return nil
    }
    return URL(fileURLWithPath: path)
  }

  @objc public func readFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    guard let url = checked(args.path, invoke) else { return }
    do {
      let data = try CoordinatedIO.read(url)
      invoke.resolve(["data": data.map { $0.base64EncodedString() } as Any? ?? NSNull()])
    } catch { invoke.reject("\(error)") }
  }

  @objc public func writeFile(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(WriteArgs.self)
    guard let url = checked(args.path, invoke) else { return }
    guard let data = Data(base64Encoded: args.data) else { invoke.reject("invalid base64"); return }
    do {
      try CoordinatedIO.write(data, to: url)
      invoke.resolve()
    } catch { invoke.reject("\(error)") }
  }

  @objc public func stat(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    guard let url = checked(args.path, invoke) else { return }
    do {
      let m = try CoordinatedIO.mtimeMs(url)
      invoke.resolve(["mtimeMs": m as Any? ?? NSNull()])
    } catch { invoke.reject("\(error)") }
  }

  @objc public func list(_ invoke: Invoke) throws {
    let args = try invoke.parseArgs(PathArgs.self)
    guard let url = checked(args.path, invoke) else { return }
    do {
      invoke.resolve(["files": try CoordinatedIO.list(url)])
    } catch { invoke.reject("\(error)") }
  }
}

@_cdecl("init_plugin_ios_bookmarks")
func initPlugin() -> Plugin {
  return IosBookmarksPlugin()
}
