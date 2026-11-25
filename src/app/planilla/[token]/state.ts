export type SubmitDeparturePassengerState = {
  status: "idle" | "ok" | "error";
  message: string;
  passengerName?: string;
  updated?: boolean;
  /** El pasajero guardado, para marcarlo en la lista (planilla rediseñada, 25-nov). */
  passengerId?: string;
  position?: number;
};

export const initialSubmitState: SubmitDeparturePassengerState = { status: "idle", message: "" };
