import Foundation

struct APIErrorEnvelope: Decodable, Error {
    let error: APIErrorDetail
}

struct APIErrorDetail: Decodable {
    let code: String
    let message: String
}

struct AuthSessionEnvelope: Decodable {
    let token: String
    let expiresAt: Date
    let user: APIUser
    let isActive: Bool?
}

struct LogoutEnvelope: Decodable {
    let ok: Bool
}

struct APIUser: Codable, Identifiable {
    let id: String
    let email: String
    let name: String?
    let role: String
}

struct Jornada: Codable {
    let fecha: String
    var servicios: [Servicio]
}

struct Nave: Codable {
    let id: String
    let nombre: String
    let interno: String?
    let patente: String?

    var etiqueta: String {
        [nombre, interno.map { "Interno \($0)" }, patente].compactMap { $0 }.joined(separator: " · ")
    }
}

struct Fila: Codable, Identifiable {
    let id: String
    let nombre: String
    let cantidad: Int
    let detalle: String
    let telefono: String?
    let registroAnterior: String?
}

struct Servicio: Codable {
    let id: String
    let fecha: String
    let tipo: String
    let titulo: String
    let salida: Date?
    let fin: Date?
    let origen: String
    let nave: Nave?
    var paradas: [String]
    var indicaciones: [String]
    var filas: [Fila]
    let compartida: Bool
    var comprobante: String?

    var clave: String { "\(id)/\(nave?.id ?? "-")/\(fecha)" }
    var primeraParada: String? {
        paradas.first { $0.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare(origen.trimmingCharacters(in: .whitespacesAndNewlines)) != .orderedSame }
    }

    func enHorario(_ ahora: Date) -> Bool {
        guard let salida, let fin else { return false }
        return salida <= ahora && ahora < fin
    }
    func permiteGPSManual(_ ahora: Date) -> Bool {
        guard nave != nil, fecha == JornadaFecha.dia(ahora), salida == nil || fin == nil else { return false }
        return (salida.map { $0 <= ahora } ?? true) && (fin.map { ahora < $0 } ?? true)
    }

    func soloResumen() -> Servicio {
        var resumen = self
        resumen.paradas = [primeraParada].compactMap { $0 }
        resumen.comprobante = nil
        resumen.filas = []
        resumen.indicaciones = []
        return resumen
    }
}

struct Marca: Codable, Identifiable {
    let id: String
    let servicioId: String
    let vehicleId: String?
    let tipo: String
    let filaId: String?
    let cantidad: Int?
    let at: Date
    var fecha: String?
    var comprobante: String?
    var driverId: String?
    var estado: String?
    var motivo: String?

    func corresponde(a servicio: Servicio) -> Bool {
        servicioId == servicio.id && vehicleId == servicio.nave?.id
    }
}

struct MarcasEnvelope: Decodable { let marcas: [Marca] }
struct MarcaRespuesta: Decodable { let estado: String; let motivo: String? }
struct UbicacionRespuesta: Decodable {}

enum JornadaFecha {
    static let calendar: Calendar = {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Argentina/Salta")!
        return cal
    }()
    private static let dia: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
    private static let hora: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "es_AR")
        f.timeZone = calendar.timeZone
        f.dateFormat = "HH:mm"
        return f
    }()
    static func dia(_ fecha: Date) -> String { dia.string(from: fecha) }
    static func hora(_ fecha: Date) -> String { hora.string(from: fecha) }
    static func semana(_ fecha: Date) -> [String] {
        (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: fecha) }.map(dia(_:))
    }
    static func cubre(_ key: String, desde: String) -> Bool {
        guard let inicio = dia.date(from: desde),
              let limite = calendar.date(byAdding: .day, value: 7, to: inicio) else { return false }
        return desde <= key && key < dia(limite)
    }

    static func etiqueta(_ key: String, hoy: String) -> String {
        if key == hoy { return "Hoy" }
        guard let date = dia.date(from: key) else { return key }
        return date.formatted(Date.FormatStyle(date: .abbreviated, time: .omitted, locale: Locale(identifier: "es_AR"), timeZone: calendar.timeZone))
    }
}
