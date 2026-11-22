import Foundation

/// Persistent storage for the vault bookmark (UserDefaults in the app, memory in tests).
public protocol BookmarkStorage: AnyObject {
    func load() -> Data?
    func save(_ data: Data?)
}

public final class UserDefaultsBookmarkStorage: BookmarkStorage {
    private let key: String
    private let defaults: UserDefaults
    public init(key: String = "devtex.vaultBookmark", defaults: UserDefaults = .standard) {
        self.key = key
        self.defaults = defaults
    }
    public func load() -> Data? { defaults.data(forKey: key) }
    public func save(_ data: Data?) {
        if let data { defaults.set(data, forKey: key) } else { defaults.removeObject(forKey: key) }
    }
}

/// URL operations that differ between platforms (security scope, bookmark options).
public protocol BookmarkResolver {
    func makeBookmark(for url: URL) throws -> Data
    /// Returns the URL and whether the bookmark is stale.
    func resolve(_ data: Data) throws -> (URL, Bool)
    func startAccess(_ url: URL) -> Bool
    func stopAccess(_ url: URL)
}

/// Security-scoped bookmarks: on iOS `.minimalBookmark`-free default options work for
/// document-picker URLs; on macOS `.withSecurityScope` would be used in a sandbox.
public struct SystemBookmarkResolver: BookmarkResolver {
    public init() {}
    public func makeBookmark(for url: URL) throws -> Data {
        try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    }
    public func resolve(_ data: Data) throws -> (URL, Bool) {
        var stale = false
        let url = try URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &stale)
        return (url, stale)
    }
    public func startAccess(_ url: URL) -> Bool { url.startAccessingSecurityScopedResource() }
    public func stopAccess(_ url: URL) { url.stopAccessingSecurityScopedResource() }
}

public enum BookmarkError: Error, Equatable {
    case accessDenied(String)
}

/// Keeps one vault folder accessible across launches.
public final class VaultBookmarks {
    private let storage: BookmarkStorage
    private let resolver: BookmarkResolver
    public private(set) var current: URL?

    public init(storage: BookmarkStorage, resolver: BookmarkResolver) {
        self.storage = storage
        self.resolver = resolver
    }

    /// Adopt a folder the user just picked: start access and persist its bookmark.
    @discardableResult
    public func adopt(_ url: URL) throws -> URL {
        guard resolver.startAccess(url) else { throw BookmarkError.accessDenied(url.path) }
        if let old = current, old != url { resolver.stopAccess(old) }
        storage.save(try resolver.makeBookmark(for: url))
        current = url
        return url
    }

    /// Cold launch: resolve the stored bookmark and start access before any file call.
    /// Refreshes a stale bookmark. Returns nil (and clears storage) when it no longer resolves.
    public func restore() -> (url: URL, refreshed: Bool)? {
        if let cur = current { return (cur, false) }
        guard let data = storage.load() else { return nil }
        do {
            let (url, stale) = try resolver.resolve(data)
            guard resolver.startAccess(url) else { return nil }
            var refreshed = false
            if stale, let fresh = try? resolver.makeBookmark(for: url) {
                storage.save(fresh)
                refreshed = true
            }
            current = url
            return (url, refreshed)
        } catch {
            storage.save(nil)
            return nil
        }
    }

    /// True when `path` is inside the current vault folder.
    public func contains(_ path: String) -> Bool {
        guard let root = current?.standardizedFileURL.path else { return false }
        let p = URL(fileURLWithPath: path).standardizedFileURL.path
        return p == root || p.hasPrefix(root.hasSuffix("/") ? root : root + "/")
    }
}

/// All reads and writes go through NSFileCoordinator (Obsidian Sync / Files may write concurrently).
public enum CoordinatedIO {
    public static func read(_ url: URL) throws -> Data? {
        var result: Result<Data?, Error> = .success(nil)
        var coordError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: [], error: &coordError) { u in
            if !FileManager.default.fileExists(atPath: u.path) { result = .success(nil); return }
            result = Result { try Data(contentsOf: u) }
        }
        if let coordError { throw coordError }
        return try result.get()
    }

    public static func write(_ data: Data, to url: URL) throws {
        var result: Result<Void, Error> = .success(())
        var coordError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(writingItemAt: url, options: .forReplacing, error: &coordError) { u in
            result = Result { try data.write(to: u, options: .atomic) }
        }
        if let coordError { throw coordError }
        try result.get()
    }

    public static func mtimeMs(_ url: URL) throws -> Double? {
        var out: Double?
        var coordError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: url, options: .immediatelyAvailableMetadataOnly, error: &coordError) { u in
            if let attrs = try? FileManager.default.attributesOfItem(atPath: u.path), let d = attrs[.modificationDate] as? Date {
                out = d.timeIntervalSince1970 * 1000
            }
        }
        if let coordError { throw coordError }
        return out
    }

    /// Regular files under `dir`, recursively, skipping hidden entries.
    public static func list(_ dir: URL) throws -> [String] {
        var files: [String] = []
        var coordError: NSError?
        NSFileCoordinator(filePresenter: nil).coordinate(readingItemAt: dir, options: [], error: &coordError) { u in
            let e = FileManager.default.enumerator(at: u, includingPropertiesForKeys: [.isRegularFileKey], options: [.skipsHiddenFiles, .skipsPackageDescendants])
            while let item = e?.nextObject() as? URL {
                if (try? item.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true { files.append(item.path) }
            }
        }
        if let coordError { throw coordError }
        return files.sorted()
    }
}
