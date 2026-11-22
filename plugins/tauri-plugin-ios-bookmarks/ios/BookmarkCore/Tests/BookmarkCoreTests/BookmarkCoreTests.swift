import Foundation
import Testing
@testable import BookmarkCore

final class MemoryStorage: BookmarkStorage {
    var data: Data?
    func load() -> Data? { data }
    func save(_ d: Data?) { data = d }
}

final class FakeResolver: BookmarkResolver {
    var stale = false
    var allow = true
    var broken = false
    var started: [URL] = []
    var stopped: [URL] = []
    func makeBookmark(for url: URL) throws -> Data { Data(url.path.utf8) }
    func resolve(_ data: Data) throws -> (URL, Bool) {
        if broken { throw CocoaError(.fileNoSuchFile) }
        return (URL(fileURLWithPath: String(decoding: data, as: UTF8.self)), stale)
    }
    func startAccess(_ url: URL) -> Bool { started.append(url); return allow }
    func stopAccess(_ url: URL) { stopped.append(url) }
}

@Test func adoptPersistsBookmarkAndStartsAccess() throws {
    let s = MemoryStorage(), r = FakeResolver()
    let v = VaultBookmarks(storage: s, resolver: r)
    try v.adopt(URL(fileURLWithPath: "/vault"))
    #expect(s.data == Data("/vault".utf8))
    #expect(r.started == [URL(fileURLWithPath: "/vault")])
}

@Test func coldLaunchRestoresAndStartsAccessBeforeUse() {
    let s = MemoryStorage(); s.data = Data("/vault".utf8)
    let r = FakeResolver()
    let v = VaultBookmarks(storage: s, resolver: r)
    let restored = v.restore()
    #expect(restored?.url.path == "/vault")
    #expect(restored?.refreshed == false)
    #expect(r.started.count == 1)
    // second call does not start access again
    _ = v.restore()
    #expect(r.started.count == 1)
}

@Test func staleBookmarkIsRefreshed() {
    let s = MemoryStorage(); s.data = Data("/vault".utf8)
    let r = FakeResolver(); r.stale = true
    let v = VaultBookmarks(storage: s, resolver: r)
    #expect(v.restore()?.refreshed == true)
}

@Test func unresolvableBookmarkIsCleared() {
    let s = MemoryStorage(); s.data = Data("/gone".utf8)
    let r = FakeResolver(); r.broken = true
    let v = VaultBookmarks(storage: s, resolver: r)
    #expect(v.restore() == nil)
    #expect(s.data == nil)
}

@Test func deniedAccessThrowsAndPersistsNothing() {
    let s = MemoryStorage(), r = FakeResolver(); r.allow = false
    let v = VaultBookmarks(storage: s, resolver: r)
    #expect(throws: BookmarkError.accessDenied("/vault")) { try v.adopt(URL(fileURLWithPath: "/vault")) }
    #expect(s.data == nil)
}

@Test func containmentCheck() throws {
    let v = VaultBookmarks(storage: MemoryStorage(), resolver: FakeResolver())
    try v.adopt(URL(fileURLWithPath: "/vault/Research"))
    #expect(v.contains("/vault/Research/paper/main.tex"))
    #expect(v.contains("/vault/Research"))
    #expect(!v.contains("/vault/ResearchX/a.tex"))
    #expect(!v.contains("/vault/Research/../secret.tex"))
}

@Test func coordinatedReadWriteRoundTrip() throws {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: dir.appendingPathComponent("ch"), withIntermediateDirectories: true)
    let f = dir.appendingPathComponent("ch/one.tex")
    #expect(try CoordinatedIO.read(f) == nil)
    try CoordinatedIO.write(Data("hello".utf8), to: f)
    #expect(try CoordinatedIO.read(f) == Data("hello".utf8))
    #expect(try CoordinatedIO.mtimeMs(f) != nil)
    try FileManager.default.createDirectory(at: dir.appendingPathComponent(".hidden"), withIntermediateDirectories: true)
    try CoordinatedIO.write(Data("x".utf8), to: dir.appendingPathComponent(".hidden/x.tex"))
    let listed = try CoordinatedIO.list(dir).map { URL(fileURLWithPath: $0).lastPathComponent }
    #expect(listed == ["one.tex"])
    try? FileManager.default.removeItem(at: dir)
}
