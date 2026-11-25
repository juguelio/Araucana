import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var session: DriverSession

    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group {
            if session.isAuthenticated {
                DriverDashboardView()
            } else {
                LoginView()
            }
        }
        .task { await session.restore() }
        .task(id: phase) {
            guard phase == .active else { return }
            var ticks = 0
            while !Task.isCancelled {
                session.pulso()
                if ticks % 6 == 0 { await session.refresh() }
                ticks += 1
                try? await Task.sleep(for: .seconds(5))
            }
        }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
            .environmentObject(DriverSession())
    }
}
