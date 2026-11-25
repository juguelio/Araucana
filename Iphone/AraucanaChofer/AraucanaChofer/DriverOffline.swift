import Foundation
import CryptoKit

struct DriverOffline: Codable {
    var user: APIUser
    var expiresAt: Date
    var jornada: Jornada?
    var hojas: Set<String> = []
    var marcas: [Marca] = []
    var pendientes: [Marca] = []
    var actualizado: Date?
    var manualGPS: String?

    func guardar(base: String) throws {
        let url = try Self.url(base: base, id: user.id)
        try JSONEncoder().encode(self).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func leer(base: String, id: String) throws -> Self? {
        let url = try self.url(base: base, id: id)
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        let cache = try JSONDecoder().decode(Self.self, from: Data(contentsOf: url))
        guard cache.user.id == id && cache.user.role == "DRIVER" else { return nil }
        return cache
    }

    func cerrar(base: String) {
        if !pendientes.isEmpty {
            var cola = DriverOffline(user: user, expiresAt: expiresAt)
            cola.pendientes = pendientes
            try? cola.guardar(base: base)
        } else {
            Self.borrar(base: base, id: user.id)
        }
    }

    private static func borrar(base: String, id: String) {
        if let url = try? self.url(base: base, id: id) { try? FileManager.default.removeItem(at: url) }
    }

    private static func url(base: String, id: String) throws -> URL {
        let storage = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        var directory = storage.appendingPathComponent("Jornadas", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var flags = URLResourceValues()
        flags.isExcludedFromBackup = true
        try directory.setResourceValues(flags)
        let key = SHA256.hash(data: Data("\(base)\n\(id)".utf8)).map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent(key + ".json")
    }
}
