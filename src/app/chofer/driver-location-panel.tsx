"use client";

import { useEffect, useRef, useState } from "react";
import { DRIVER_LOCATION_UPDATE_INTERVAL_MS } from "@/lib/driver/location";

type DriverVehicle = {
  id: string;
  name: string;
  brand: string;
  model: string;
  licensePlate: string | null;
};

type DriverLocationPanelProps = {
  vehicles: DriverVehicle[];
  initialVehicleId?: string;
};

type BatteryManager = EventTarget & {
  charging: boolean;
  level: number;
};

type NavigatorWithTelemetry = Navigator & {
  getBattery?: () => Promise<BatteryManager>;
  connection?: {
    effectiveType?: string;
    type?: string;
  };
};

function vehicleLabel(vehicle: DriverVehicle) {
  return `${vehicle.name} · ${vehicle.brand} ${vehicle.model}${vehicle.licensePlate ? ` · ${vehicle.licensePlate}` : ""}`;
}

async function readDeviceTelemetry() {
  const telemetryNavigator = navigator as NavigatorWithTelemetry;
  const battery = telemetryNavigator.getBattery ? await telemetryNavigator.getBattery().catch(() => null) : null;

  return {
    batteryLevel: battery?.level ?? null,
    batteryCharging: battery?.charging ?? null,
    clientNetworkType: telemetryNavigator.connection?.effectiveType ?? telemetryNavigator.connection?.type ?? null
  };
}

/**
 * Panel del chofer (issue #316). El pedido del cliente es «mientras el chofer esté logueado»: el
 * envío arranca solo al entrar al panel, con la nave que ya tenía elegida, y el botón queda como
 * pausa explícita. Si el navegador niega el permiso, se dice con instrucciones en vez de dejar de
 * mandar en silencio (el admin lo ve como «sin ubicación»).
 */
export function DriverLocationPanel({ vehicles, initialVehicleId = "" }: DriverLocationPanelProps) {
  const [selectedVehicleId, setSelectedVehicleId] = useState(initialVehicleId);
  const [paused, setPaused] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [message, setMessage] = useState("");
  const [ultimoEnvio, setUltimoEnvio] = useState<string | null>(null);
  const isSendingRef = useRef(false);

  const sharing = Boolean(selectedVehicleId) && !paused && !blocked;

  useEffect(() => {
    if (!sharing || !selectedVehicleId) {
      return;
    }

    if (!("geolocation" in navigator)) {
      setBlocked(true);
      setMessage("Este dispositivo no permite compartir ubicación.");
      return;
    }

    let stopped = false;

    async function sendPosition(position: GeolocationPosition) {
      if (isSendingRef.current || stopped) {
        return;
      }

      isSendingRef.current = true;

      try {
        const deviceTelemetry = await readDeviceTelemetry();
        const response = await fetch("/api/v1/driver/location", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            vehicleId: selectedVehicleId,
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            heading: position.coords.heading,
            speed: position.coords.speed,
            altitude: position.coords.altitude,
            altitudeAccuracy: position.coords.altitudeAccuracy,
            ...deviceTelemetry,
            recordedAt: new Date(position.timestamp).toISOString()
          })
        });

        if (!response.ok) {
          throw new Error("No pudimos actualizar la ubicación.");
        }

        if (stopped) return;
        setUltimoEnvio(new Date().toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }));
        setMessage("");
      } catch (error) {
        if (stopped) return;
        // Un corte de red no apaga el compartir: el próximo intento (3 s) lo resuelve.
        setMessage(error instanceof Error ? error.message : "No pudimos actualizar la ubicación.");
      } finally {
        isSendingRef.current = false;
      }
    }

    function requestPosition() {
      navigator.geolocation.getCurrentPosition(
        sendPosition,
        (error) => {
          if (stopped) return;
          if (error.code === error.PERMISSION_DENIED) {
            setBlocked(true);
            setMessage(
              "El navegador tiene bloqueado el acceso a la ubicación. Abrí el candado de la barra de direcciones, elegí «Ubicación» y permitila; después tocá «Reintentar»."
            );
            return;
          }
          setMessage("No pudimos leer tu ubicación todavía. Reintentamos solos en unos segundos.");
        },
        {
          enableHighAccuracy: true,
          maximumAge: 1000,
          timeout: 8000
        }
      );
    }

    requestPosition();
    const intervalId = window.setInterval(requestPosition, DRIVER_LOCATION_UPDATE_INTERVAL_MS);

    return () => {
      stopped = true;
      window.clearInterval(intervalId);
    };
  }, [selectedVehicleId, sharing]);

  const canShare = vehicles.length > 0 && Boolean(selectedVehicleId);

  return (
    <section className="plain-card admin-section">
      <div className="admin-form-grid">
        <label className="span-2">
          Nave
          <select
            value={selectedVehicleId}
            onChange={(event) => {
              setSelectedVehicleId(event.target.value);
              setMessage("");
            }}
          >
            <option value="">Elegir nave</option>
            {vehicles.map((vehicle) => (
              <option key={vehicle.id} value={vehicle.id}>
                {vehicleLabel(vehicle)}
              </option>
            ))}
          </select>
        </label>

        <div className="span-2 table-actions">
          {sharing ? (
            <button
              className="button"
              type="button"
              onClick={() => {
                setPaused(true);
                setUltimoEnvio(null);
                setMessage("Ubicación pausada: la operación no ve dónde estás hasta que la reanudes.");
              }}
            >
              Pausar
            </button>
          ) : (
            <button
              className="button"
              type="button"
              disabled={!canShare}
              onClick={() => {
                setBlocked(false);
                setPaused(false);
                setMessage("");
              }}
            >
              {blocked ? "Reintentar" : "Compartir ubicación"}
            </button>
          )}
          {sharing ? (
            <span className="muted">
              Compartiendo sola desde que entraste
              {ultimoEnvio ? ` · última señal ${ultimoEnvio}` : " · esperando la primera señal"}.
            </span>
          ) : null}
        </div>

        {!selectedVehicleId ? (
          <p className="muted span-2">Elegí la nave que estás manejando para empezar a compartir la ubicación.</p>
        ) : null}

        {message ? <p className={blocked ? "error span-2" : "muted span-2"}>{message}</p> : null}
      </div>
    </section>
  );
}
