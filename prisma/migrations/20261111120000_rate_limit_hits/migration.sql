-- Freno contra ráfagas de pedidos (informe del 10-nov: 15 reservas seguidas llenaban una combi).
-- Un contador por clave (IP + tipo de pedido) y ventana de tiempo; la clave incluye la ventana
-- truncada, así que cada ventana nueva arranca de cero sin tareas de limpieza.
CREATE TABLE IF NOT EXISTS "RateLimitHit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "RateLimitHit_pkey" PRIMARY KEY ("key","windowStart")
);

CREATE INDEX IF NOT EXISTS "RateLimitHit_windowStart_idx" ON "RateLimitHit"("windowStart");
