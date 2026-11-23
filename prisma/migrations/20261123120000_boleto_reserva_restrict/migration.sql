-- Boleto numerado del servicio público (issue #381): el número emitido no se puede perder
-- borrando la reserva. `CASCADE` se llevaba la fila de `ServiceTicket` y dejaba un hueco
-- silencioso en la serie (W001, W002, W004) que después nadie puede explicar.
--
-- Con `RESTRICT`, igual que `seriesId`: si hay boleto, la reserva no se borra. El camino que el
-- modelo ya contempla es cancelar, que anula el boleto conservando su número, motivo y usuario.
ALTER TABLE "ServiceTicket" DROP CONSTRAINT "ServiceTicket_reservationId_fkey";

ALTER TABLE "ServiceTicket" ADD CONSTRAINT "ServiceTicket_reservationId_fkey"
    FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
