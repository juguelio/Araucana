import Foundation

struct APIErrorEnvelope: Decodable, Error {
    let error: APIErrorDetail
}

struct APIErrorDetail: Decodable {
    let code: String
    let message: String
}

struct UserEnvelope: Decodable {
    let user: APIUser?
}

struct APIUser: Decodable, Identifiable {
    let id: String
    let email: String
    let name: String?
    let role: String
}

struct RoutesEnvelope: Decodable {
    let routes: [TravelRoute]
}

struct TravelRoute: Decodable, Identifiable {
    let id: String
    let slug: String
    let from: String
    let to: String
    let via: String
    let durationMin: Int
    let priceCents: Int
    let currency: String
}

struct DriverBootstrap: Decodable {
    let user: APIUser
    let vehicles: [DriverVehicle]
    let routes: [DriverRouteOption]
    let schedules: [DriverSchedule]
    let currentLocation: DriverLocation?
}

struct DriverVehicle: Decodable, Identifiable {
    let id: String
    let name: String
    let brand: String
    let model: String
    let licensePlate: String?
}

struct DriverLocation: Decodable {
    let vehicleId: String
    let vehicleName: String
    let latitude: Double
    let longitude: Double
    let accuracy: Double?
    let heading: Double?
    let speed: Double?
    let recordedAt: Date
    let updatedAt: Date
}

struct DriverRouteOption: Decodable, Identifiable {
    let id: String
    let slug: String
    let from: String
    let to: String
    let via: String
    let label: String
}

struct DriverRouteStop: Decodable, Identifiable {
    let name: String
    let minutes: Int?
    let note: String?

    var id: String {
        "\(name)-\(minutes ?? -1)"
    }
}

struct DriverSchedule: Decodable, Identifiable {
    let id: String
    let routeId: String
    let route: DriverRouteOption
    let routeLabel: String
    let departureAt: Date
    let arrivalAt: Date
    let status: String
    let vehicle: DriverScheduleVehicle
    let stops: [DriverRouteStop]
    let totalSeats: Int
    let availableSeats: Int
    let reservationCount: Int
    let passengerCount: Int
    let passengers: [DriverSchedulePassenger]
}

struct DriverScheduleVehicle: Decodable, Identifiable {
    let id: String
    let name: String
    let licensePlate: String?
}

struct DriverSchedulePassenger: Decodable, Identifiable {
    let reservationId: String
    let code: String
    let passengerName: String
    let phone: String
    let documentLabel: String
    let seatNumber: String?
    let passengerCount: Int
    let reservationStatus: String
    let paymentStatus: String?

    var id: String {
        reservationId
    }
}
