type OpenApiSpec = {
  openapi: "3.1.0";
  info: {
    title: string;
    version: string;
    description: string;
  };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, unknown>>;
  components: {
    securitySchemes: Record<string, unknown>;
    schemas: Record<string, unknown>;
  };
};

const bearerSecurity = [{ bearerAuth: [] }];

function jsonResponse(schemaRef: string) {
  return {
    "200": {
      description: "OK",
      content: {
        "application/json": {
          schema: {
            $ref: schemaRef
          }
        }
      }
    }
  };
}

function adminPath(summary: string, responseRef: string) {
  return {
    summary,
    security: bearerSecurity,
    responses: jsonResponse(responseRef)
  };
}

export function getOpenApiSpec(baseUrl = "https://araucana.app"): OpenApiSpec {
  return {
    openapi: "3.1.0",
    info: {
      title: "Araucana API",
      version: "1.0.0",
      description: "API JSON compartida por la web, iPhone SwiftUI y Android nativo."
    },
    servers: [{ url: baseUrl }],
    paths: {
      "/api/v1/auth/register": {
        post: {
          summary: "Registra una cuenta pendiente con email y contraseña.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { name: { type: "string" }, email: { type: "string", format: "email" }, password: { type: "string", minLength: 12, maxLength: 128 } } } } } },
          responses: { "201": { description: "Cuenta pendiente de aprobación" }, "400": { description: "Datos inválidos" }, "409": { description: "Email ya registrado" } }
        }
      },
      "/api/v1/auth/login": {
        post: {
          summary: "Inicia sesión y emite un JWT.",
          requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["email", "password"], properties: { email: { type: "string", format: "email" }, password: { type: "string" } } } } } },
          responses: { "200": { description: "Sesión creada" }, "401": { description: "Credenciales inválidas" } }
        }
      },
      "/api/v1/auth/refresh": {
        post: { summary: "Rota el JWT actual.", security: bearerSecurity, responses: { "200": { description: "Sesión renovada" }, "401": { description: "Sesión inválida" } } }
      },
      "/api/v1/auth/logout": {
        post: { summary: "Revoca la sesión actual.", security: bearerSecurity, responses: { "200": { description: "Sesión cerrada" } } }
      },
      "/api/v1/auth/me": {
        get: {
          summary: "Devuelve el usuario autenticado.",
          security: bearerSecurity,
          responses: jsonResponse("#/components/schemas/UserEnvelope")
        }
      },
      "/api/v1/routes": {
        get: {
          summary: "Lista rutas publicas activas.",
          responses: jsonResponse("#/components/schemas/RoutesEnvelope")
        }
      },
      "/api/v1/routes/{slug}": {
        get: {
          summary: "Obtiene una ruta publica por slug.",
          parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
          responses: jsonResponse("#/components/schemas/RouteEnvelope")
        }
      },
      "/api/v1/schedules": {
        get: {
          summary: "Lista salidas publicas para una ruta.",
          parameters: [{ name: "routeId", in: "query", required: true, schema: { type: "string" } }],
          responses: jsonResponse("#/components/schemas/SchedulesEnvelope")
        }
      },
      "/api/v1/reservations": {
        post: {
          summary: "Crea una reserva web/mobile.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/CreateReservationInput" }
              }
            }
          },
          responses: {
            "201": {
              description: "Reserva creada",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReservationEnvelope" }
                }
              }
            }
          }
        }
      },
      "/api/v1/reservations/{code}": {
        description: "El código nuevo es un enlace privado de 128 bits. Los códigos cortos anteriores requieren una sesión ADMIN o SECRETARY activa.",
        get: {
          summary: "Consulta una reserva por codigo.",
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          responses: jsonResponse("#/components/schemas/ReservationEnvelope")
        }
      },
      "/api/v1/reservations/{code}/receipt": {
        post: {
          summary: "Sube comprobante de pago manual desde mobile.",
          parameters: [{ name: "code", in: "path", required: true, schema: { type: "string" } }],
          requestBody: {
            required: true,
            content: {
              "multipart/form-data": {
                schema: {
                  type: "object",
                  required: ["receipt"],
                  properties: {
                    receipt: { type: "string", format: "binary" }
                  }
                }
              }
            }
          },
          responses: jsonResponse("#/components/schemas/ReservationEnvelope")
        }
      },
      "/api/v1/chapelco/availability": {
        get: {
          summary: "Consulta cupos Chapelco por fecha y horario.",
          parameters: [
            { name: "routeId", in: "query", required: true, schema: { type: "string" } },
            { name: "date", in: "query", required: true, schema: { type: "string", format: "date" } }
          ],
          responses: jsonResponse("#/components/schemas/ChapelcoAvailabilityEnvelope")
        }
      },
      "/api/v1/driver/bootstrap": {
        get: {
          summary: "Devuelve datos iniciales del chofer, rutas de trabajo, salidas proximas y pasajeros.",
          security: bearerSecurity,
          responses: jsonResponse("#/components/schemas/DriverBootstrapEnvelope")
        }
      },
      "/api/v1/driver/chapelco": {
        get: {
          summary: "Devuelve manifiestos Chapelco del chofer autenticado.",
          security: bearerSecurity,
          parameters: [{ name: "date", in: "query", required: false, schema: { type: "string", format: "date" } }],
          responses: jsonResponse("#/components/schemas/ChapelcoDriverManifestEnvelope")
        },
        patch: {
          summary: "Actualiza estado de una parada Chapelco del chofer autenticado.",
          security: bearerSecurity,
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["stopId", "status"],
                  properties: {
                    stopId: { type: "string" },
                    status: { type: "string", enum: ["PENDING", "BOARDED", "NO_SHOW", "TRANSPORTED"] }
                  }
                }
              }
            }
          },
          responses: jsonResponse("#/components/schemas/ChapelcoStopEnvelope")
        }
      },
      "/api/v1/admin/routes": {
        get: adminPath("Lista rutas para administracion.", "#/components/schemas/RoutesEnvelope"),
        post: {
          ...adminPath("Crea una ruta.", "#/components/schemas/RouteEnvelope"),
          requestBody: { $ref: "#/components/schemas/AdminRouteInputBody" }
        }
      },
      "/api/v1/admin/routes/{id}": {
        get: adminPath("Obtiene una ruta admin.", "#/components/schemas/RouteEnvelope"),
        patch: adminPath("Actualiza una ruta o su estado activo.", "#/components/schemas/RouteEnvelope"),
        delete: adminPath("Borra o archiva una ruta.", "#/components/schemas/DeleteEnvelope")
      },
      "/api/v1/admin/schedules": {
        get: adminPath("Lista salidas para administracion.", "#/components/schemas/SchedulesEnvelope"),
        post: adminPath("Crea una salida.", "#/components/schemas/ScheduleEnvelope")
      },
      "/api/v1/admin/schedules/{id}": {
        get: adminPath("Obtiene una salida admin.", "#/components/schemas/ScheduleEnvelope"),
        patch: adminPath("Actualiza una salida o su estado.", "#/components/schemas/ScheduleEnvelope"),
        delete: adminPath("Borra o cierra una salida.", "#/components/schemas/DeleteEnvelope")
      },
      "/api/v1/admin/vehicles": {
        get: adminPath("Lista naves.", "#/components/schemas/VehiclesEnvelope"),
        post: adminPath("Crea una nave.", "#/components/schemas/VehicleEnvelope")
      },
      "/api/v1/admin/vehicles/{id}": {
        get: adminPath("Obtiene una nave.", "#/components/schemas/VehicleEnvelope"),
        patch: adminPath("Actualiza una nave o su estado activo.", "#/components/schemas/VehicleEnvelope"),
        delete: adminPath("Borra o archiva una nave.", "#/components/schemas/DeleteEnvelope")
      },
      "/api/v1/admin/reservations": {
        get: adminPath("Lista reservas admin.", "#/components/schemas/AdminReservationsEnvelope")
      },
      "/api/v1/admin/reservations/{code}": {
        get: adminPath("Obtiene una reserva admin.", "#/components/schemas/ReservationEnvelope"),
        patch: adminPath("Actualiza datos de pasajero de una reserva.", "#/components/schemas/ReservationEnvelope")
      },
      "/api/v1/admin/reservations/{code}/approve-payment": {
        post: adminPath("Aprueba un pago manual con comprobante.", "#/components/schemas/ReservationEnvelope")
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      schemas: {
        ApiError: {
          type: "object",
          required: ["error"],
          properties: {
            error: {
              type: "object",
              required: ["code", "message"],
              properties: {
                code: { type: "string" },
                message: { type: "string" },
                fields: {
                  type: "object",
                  additionalProperties: { type: "string" }
                }
              }
            }
          }
        },
        User: {
          type: "object",
          required: ["id", "email", "role"],
          properties: {
            id: { type: "string" },
            email: { type: "string", format: "email" },
            name: { type: ["string", "null"] },
            role: { type: "string", enum: ["ADMIN", "SECRETARY", "DRIVER", "USER"] }
          }
        },
        UserEnvelope: { type: "object", properties: { user: { $ref: "#/components/schemas/User" } } },
        Route: {
          type: "object",
          properties: {
            id: { type: "string" },
            slug: { type: "string" },
            from: { type: "string" },
            to: { type: "string" },
            via: { type: "string" },
            durationMin: { type: "integer" },
            priceCents: { type: "integer" },
            currency: { type: "string" },
            serviceStartDate: { type: "string", format: "date", nullable: true },
            serviceEndDate: { type: "string", format: "date", nullable: true }
          }
        },
        RouteEnvelope: { type: "object", properties: { route: { $ref: "#/components/schemas/Route" } } },
        RoutesEnvelope: {
          type: "object",
          properties: {
            routes: { type: "array", items: { $ref: "#/components/schemas/Route" } }
          }
        },
        ScheduleEnvelope: { type: "object", properties: { schedule: { type: "object" } } },
        SchedulesEnvelope: { type: "object", properties: { schedules: { type: "array", items: { type: "object" } } } },
        VehicleEnvelope: { type: "object", properties: { vehicle: { type: "object" } } },
        VehiclesEnvelope: { type: "object", properties: { vehicles: { type: "array", items: { type: "object" } } } },
        ReservationEnvelope: { type: "object", properties: { reservation: { type: "object" } } },
        AdminReservationsEnvelope: { type: "object", properties: { reservations: { type: "array", items: { type: "object" } } } },
        ChapelcoAvailabilityEnvelope: {
          type: "object",
          properties: {
            routeId: { type: "string" },
            serviceDate: { type: "string", format: "date" },
            serviceStartDate: { type: "string", format: "date", nullable: true },
            serviceEndDate: { type: "string", format: "date", nullable: true },
            isServiceActive: { type: "boolean" },
            slots: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  slot: { type: "string", enum: ["08:30", "09:00", "10:30", "12:00"] },
                  totalCapacity: { type: "integer" },
                  reservedPeople: { type: "integer" },
                  availablePeople: { type: "integer" }
                }
              }
            }
          }
        },
        ChapelcoDriverManifestEnvelope: { type: "object", properties: { date: { type: "string" }, runs: { type: "array", items: { type: "object" } } } },
        ChapelcoStopEnvelope: { type: "object", properties: { stop: { type: "object" } } },
        DriverBootstrapEnvelope: {
          type: "object",
          properties: {
            user: { $ref: "#/components/schemas/User" },
            vehicles: { type: "array", items: { type: "object" } },
            routes: { type: "array", items: { type: "object" } },
            schedules: { type: "array", items: { type: "object" } },
            currentLocation: { type: ["object", "null"] }
          }
        },
        DeleteEnvelope: {
          type: "object",
          properties: {
            deleted: { type: "boolean" },
            archived: { type: "boolean" }
          }
        },
        CreateReservationInput: {
          type: "object",
          required: ["scheduleId", "passengerCount", "passenger"],
          properties: {
            scheduleId: { type: "string" },
            passengerCount: { type: "integer", minimum: 1 },
            passenger: { type: "object" }
          }
        },
        AdminRouteInputBody: {
          type: "object",
          properties: {
            content: {
              type: "object",
              properties: {
                "application/json": {
                  schema: {
                    type: "object"
                  }
                }
              }
            }
          }
        }
      }
    }
  };
}
